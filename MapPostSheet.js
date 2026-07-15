// MapPostSheet.js — the map-native way to post a job. A single elegant sheet
// that rises over the fullscreen command centre, so posting never leaves the map.
// This is a SEPARATE, purpose-built UI from the home-screen RequestSheet — but it
// calls the SAME createRequest service (shared logic, forked presentation only).
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView, ActivityIndicator,
  StyleSheet, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { createRequest } from './requestsService';
import { searchAddress, reverseGeocode } from './geocodeService';
import { loadTaxonomy, FRONT_DOORS, groupedTradesForDoor } from './taxonomyService';
import { getPosition } from './location';

const KINDS = { equipment: 'plant', trades: 'crew', work: 'crew', tasks: 'task' };

// Default hourly/job rates — MUST stay in sync with SHEET_RATES in App.js.
// (Kept here rather than imported to avoid a circular import App<->MapHero<->this.)
const SHEET_RATES = {
  'Excavator': 110, 'Line pump': 180, 'Dozer': 160, 'Tipper': 120, 'Mobile crane': 250, 'Water cart': 110,
  'Labourer': 40, 'Traffic controller': 38, 'Machine operator': 55, 'Dogman / rigger': 60, 'Spotter': 45, 'Concreter': 58,
  'Bunnings pickup': 30, 'Parts run': 30, 'Bin / tip run': 50, 'Materials drop': 40,
};
const rateFor = (name, kind) => SHEET_RATES[name] || (kind === 'task' ? 40 : 55);

export default function MapPostSheet({ visible, onClose, onPosted, myLoc }) {
  const [step, setStep] = useState('what');      // what -> where -> confirm
  const [taxonomy, setTaxonomy] = useState(null);
  const [door, setDoor] = useState(null);        // FRONT_DOORS key
  const [trade, setTrade] = useState(null);      // { id/type, kind, ... }
  const [qty, setQty] = useState(1);
  const [when, setWhen] = useState('now');       // now | booked
  const [bookDay, setBookDay] = useState(null);  // 0=today,1=tomorrow,2=day after...
  const [bookSlot, setBookSlot] = useState(null); // hour of day, e.g. 7, 12, 15
  const [loc, setLoc] = useState('');
  const [coords, setCoords] = useState(null);
  const [contactName, setContactName] = useState('');   // optional site contact
  const [contactPhone, setContactPhone] = useState('');
  const [materialsCap, setMaterialsCap] = useState(''); // optional materials budget
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!visible) return;
    // reset each open
    setStep('what'); setDoor(null); setTrade(null); setQty(1); setWhen('now');
    setBookDay(null); setBookSlot(null);
    setLoc(''); setCoords(null); setResults([]); setErr('');
    if (!taxonomy) { loadTaxonomy().then(setTaxonomy).catch(() => {}); }
  }, [visible]); // eslint-disable-line

  const doSearch = useCallback(async (q) => {
    setLoc(q); setCoords(null);
    if (!q || q.length < 3) { setResults([]); return; }
    setSearching(true);
    try { const r = await searchAddress(q); setResults(r || []); } catch (_) { setResults([]); } finally { setSearching(false); }
  }, []);

  async function useCurrent() {
    setErr('');
    try {
      const p = myLoc || await getPosition();
      setCoords({ lat: p.lat, lng: p.lng });
      setLoc('Locating…');
      setResults([]);
      // turn the coords into a real place name (best-effort; coords are what matter)
      const label = await reverseGeocode(p.lat, p.lng);
      setLoc(label ? `📍 ${label}` : '📍 Current location');
    } catch (_) { setErr('Could not get your location — search instead.'); }
  }

  function pickResult(r) {
    setLoc(r.label || r.address || r.name || 'Selected location');
    setCoords({ lat: r.lat, lng: r.lng });
    setResults([]);
  }

  const tradeGroups = taxonomy && door ? groupedTradesForDoor(taxonomy, door) : [];

  // next 5 days as chips: Today, Tomorrow, then weekday names
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayChips = [0, 1, 2, 3, 4].map((offset) => {
    const d = new Date(); d.setDate(d.getDate() + offset);
    const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : `${DAY_NAMES[d.getDay()]} ${d.getDate()}`;
    return { offset, label };
  });
  const SLOTS = [
    { hour: 7, label: 'Early · 7am' },
    { hour: 9, label: 'Morning · 9am' },
    { hour: 12, label: 'Midday · 12pm' },
    { hour: 15, label: 'Arvo · 3pm' },
  ];
  // build the actual scheduled timestamp (local) from chosen day offset + hour
  function scheduledISO() {
    if (bookDay == null || bookSlot == null) return null;
    const d = new Date(); d.setDate(d.getDate() + bookDay);
    d.setHours(bookSlot, 0, 0, 0);
    return d.toISOString();  // stored UTC (per §7: store UTC, display local)
  }

  async function submit() {
    setErr('');
    if (!trade) { setErr('Pick what you need.'); setStep('what'); return; }
    if (!coords) { setErr('Set a location.'); setStep('where'); return; }
    const sched = when === 'booked' ? scheduledISO() : null;
    if (when === 'booked' && !sched) { setErr('Pick a day and time.'); return; }
    setBusy(true);
    try {
      const kind = KINDS[door] || 'crew';
      const typeName = trade.name || trade.type || trade.label;
      const item = { kind, type: typeName, qty, rate: rateFor(typeName, kind), priceMode: kind === 'task' ? 'job' : 'hour', hire: null, tickets: kind === 'crew' ? ['White Card'] : [] };
      await createRequest({ when_type: when, address_text: loc, lat: coords.lat, lng: coords.lng, duration_hours: 4, items: [item], scheduled_for: sched, siteContact: { name: contactName, phone: contactPhone }, materialsCap: parseFloat(materialsCap) || 0 });
      setBusy(false);
      onPosted && onPosted();
      onClose && onClose(true);
    } catch (e) {
      setBusy(false);
      setErr((e && e.message) || 'Could not post. Try again.');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => onClose && onClose(false)}>
      <View style={s.scrim}>
        <TouchableOpacity style={s.backdrop} activeOpacity={1} onPress={() => onClose && onClose(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.handle} />

            {/* header with step context */}
            <View style={s.head}>
              <Text style={s.title}>
                {step === 'what' ? 'What do you need on site?' : step === 'where' ? 'Where is the job?' : 'Post this job'}
              </Text>
              <TouchableOpacity onPress={() => onClose && onClose(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={s.close}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* ---- STEP: WHAT ---- */}
            {step === 'what' && (
              <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
                {!door ? (
                  <View style={s.doorGrid}>
                    {FRONT_DOORS.map((d) => (
                      <TouchableOpacity key={d.key} style={[s.door, { borderColor: d.color }]} activeOpacity={0.85} onPress={() => setDoor(d.key)}>
                        <View style={[s.doorDot, { backgroundColor: d.color }]} />
                        <Text style={s.doorLabel}>{d.label}</Text>
                        <Text style={s.doorSub}>{d.sub}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : !taxonomy ? (
                  <ActivityIndicator color="#5B4BFF" style={{ marginVertical: 24 }} />
                ) : (
                  <>
                    <TouchableOpacity onPress={() => setDoor(null)} style={s.backRow}><Text style={s.backT}>‹ Categories</Text></TouchableOpacity>
                    {tradeGroups.map((g) => (
                      <View key={g.category?.id || g.category?.name} style={{ marginBottom: 8 }}>
                        <Text style={s.groupLabel}>{g.category?.name}</Text>
                        {g.trades.map((t) => (
                          <TouchableOpacity key={t.id || t.name} style={[s.tradeRow, trade && (trade.id || trade.name) === (t.id || t.name) && s.tradeRowOn]} activeOpacity={0.8}
                            onPress={() => { setTrade(t); setStep('where'); }}>
                            <Text style={s.tradeT}>{t.name || t.type}</Text>
                            <Text style={s.tradeChevron}>›</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ))}
                  </>
                )}
              </ScrollView>
            )}

            {/* ---- STEP: WHERE ---- */}
            {step === 'where' && (
              <View>
                <View style={s.pickedRow}>
                  <Text style={s.pickedT}>{trade?.name || trade?.type}{qty > 1 ? ` ×${qty}` : ''}</Text>
                  <TouchableOpacity onPress={() => setStep('what')}><Text style={s.changeT}>Change</Text></TouchableOpacity>
                </View>

                <View style={s.qtyRow}>
                  <Text style={s.qtyLabel}>How many?</Text>
                  <View style={s.qtyCtrls}>
                    <TouchableOpacity style={s.qtyBtn} onPress={() => setQty(Math.max(1, qty - 1))}><Text style={s.qtyBtnT}>−</Text></TouchableOpacity>
                    <Text style={s.qtyN}>{qty}</Text>
                    <TouchableOpacity style={s.qtyBtn} onPress={() => setQty(qty + 1)}><Text style={s.qtyBtnT}>+</Text></TouchableOpacity>
                  </View>
                </View>

                <TouchableOpacity style={s.currentBtn} activeOpacity={0.85} onPress={useCurrent}>
                  <Text style={s.currentT}>◎  Use my current location</Text>
                </TouchableOpacity>

                <TextInput
                  style={s.input}
                  placeholder="Or search an address…"
                  placeholderTextColor="#8A8A98"
                  value={loc.startsWith('📍') || loc === 'Locating…' ? '' : loc}
                  onChangeText={doSearch}
                />
                {searching && <ActivityIndicator color="#5B4BFF" style={{ marginTop: 8 }} />}
                {results.map((r, i) => (
                  <TouchableOpacity key={i} style={s.resultRow} onPress={() => pickResult(r)}>
                    <Text style={s.resultT} numberOfLines={1}>{r.label || r.address || r.name}</Text>
                  </TouchableOpacity>
                ))}

                {coords && (
                  <TouchableOpacity style={s.nextBtn} activeOpacity={0.9} onPress={() => setStep('confirm')}>
                    <Text style={s.nextT}>Continue</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ---- STEP: CONFIRM ---- */}
            {step === 'confirm' && (
              <View>
                <View style={s.confirmCard}>
                  <Row k="What" v={`${trade?.name || trade?.type}${qty > 1 ? ` ×${qty}` : ''}`} />
                  <Row k="Where" v={loc} />
                </View>
                <View style={s.whenRow}>
                  <TouchableOpacity style={[s.whenBtn, when === 'now' && s.whenOn]} onPress={() => setWhen('now')}>
                    <Text style={[s.whenT, when === 'now' && s.whenTOn]}>Now — urgent</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.whenBtn, when === 'booked' && s.whenOn]} onPress={() => setWhen('booked')}>
                    <Text style={[s.whenT, when === 'booked' && s.whenTOn]}>Book ahead</Text>
                  </TouchableOpacity>
                </View>

                {when === 'booked' && (
                  <View style={s.bookBox}>
                    <Text style={s.bookLabel}>Which day?</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                      {dayChips.map((d) => (
                        <TouchableOpacity key={d.offset} style={[s.chip, bookDay === d.offset && s.chipOn]} onPress={() => setBookDay(d.offset)}>
                          <Text style={[s.chipT, bookDay === d.offset && s.chipTOn]}>{d.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={s.bookLabel}>What time?</Text>
                    <View style={s.slotGrid}>
                      {SLOTS.map((sl) => (
                        <TouchableOpacity key={sl.hour} style={[s.slot, bookSlot === sl.hour && s.chipOn]} onPress={() => setBookSlot(sl.hour)}>
                          <Text style={[s.chipT, bookSlot === sl.hour && s.chipTOn]}>{sl.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}

                <View style={s.contactBox}>
                  <Text style={s.bookLabel}>Site contact <Text style={{ color: '#9A948A', fontWeight: '400' }}>(optional — defaults to you)</Text></Text>
                  <TextInput style={s.contactInput} value={contactName} onChangeText={setContactName}
                    placeholder="Who to ask for on site" placeholderTextColor="#B8B2A8" />
                  <TextInput style={s.contactInput} value={contactPhone} onChangeText={setContactPhone}
                    placeholder="Their phone (optional)" placeholderTextColor="#B8B2A8" keyboardType="phone-pad" />
                </View>

                <View style={s.contactBox}>
                  <Text style={s.bookLabel}>Materials budget <Text style={{ color: '#9A948A', fontWeight: '400' }}>(optional — if they'll buy parts)</Text></Text>
                  <TextInput style={s.contactInput} value={materialsCap} onChangeText={setMaterialsCap}
                    placeholder="$0 — cap on materials you'll cover" placeholderTextColor="#B8B2A8" keyboardType="decimal-pad" />
                </View>

                <TouchableOpacity style={[s.postBtn, busy && { opacity: 0.6 }]} activeOpacity={0.9} onPress={submit} disabled={busy}>
                  <Text style={s.postT}>{busy ? 'Posting…' : when === 'booked' ? 'Book this job' : 'Post job — get help now'}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setStep('where')} style={{ paddingVertical: 10 }}>
                  <Text style={s.backCenter}>‹ Back</Text>
                </TouchableOpacity>
              </View>
            )}

            {!!err && <Text style={s.err}>{err}</Text>}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function Row({ k, v }) {
  return (
    <View style={s.row}>
      <Text style={s.rowK}>{k}</Text>
      <Text style={s.rowV} numberOfLines={1}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { backgroundColor: '#141419', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 8, paddingBottom: 34, paddingHorizontal: 22 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', alignSelf: 'center', marginBottom: 14 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { color: '#fff', fontSize: 19, fontWeight: '800', letterSpacing: -0.3, flex: 1 },
  close: { color: '#8A8A98', fontSize: 20, fontWeight: '600', paddingLeft: 12 },
  doorGrid: { gap: 10 },
  door: { borderWidth: 1.5, borderRadius: 16, padding: 16, backgroundColor: 'rgba(255,255,255,0.03)' },
  doorDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 8 },
  doorLabel: { color: '#fff', fontSize: 16, fontWeight: '800' },
  doorSub: { color: '#A6A6B8', fontSize: 12.5, marginTop: 2 },
  backRow: { paddingVertical: 8 },
  backT: { color: '#7C6BFF', fontSize: 14, fontWeight: '700' },
  groupLabel: { color: '#8A8A98', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6, marginBottom: 4 },
  tradeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)', marginBottom: 6 },
  tradeRowOn: { backgroundColor: 'rgba(91,75,255,0.2)' },
  tradeT: { color: '#EDEDF2', fontSize: 15, fontWeight: '600' },
  tradeChevron: { color: '#8A8A98', fontSize: 20, fontWeight: '300' },
  pickedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  pickedT: { color: '#fff', fontSize: 16, fontWeight: '800' },
  changeT: { color: '#7C6BFF', fontSize: 13.5, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  qtyLabel: { color: '#A6A6B8', fontSize: 14, fontWeight: '600' },
  qtyCtrls: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  qtyBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  qtyBtnT: { color: '#fff', fontSize: 22, fontWeight: '600' },
  qtyN: { color: '#fff', fontSize: 18, fontWeight: '800', minWidth: 22, textAlign: 'center' },
  currentBtn: { backgroundColor: 'rgba(91,75,255,0.16)', borderRadius: 14, paddingVertical: 15, alignItems: 'center', marginBottom: 10 },
  currentT: { color: '#7C6BFF', fontSize: 15, fontWeight: '700' },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, color: '#fff', fontSize: 15 },
  resultRow: { paddingVertical: 13, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  resultT: { color: '#EDEDF2', fontSize: 14 },
  nextBtn: { backgroundColor: '#5B4BFF', borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 16 },
  nextT: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  confirmCard: { backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 16, padding: 16, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  rowK: { color: '#8A8A98', fontSize: 13, fontWeight: '600' },
  rowV: { color: '#EDEDF2', fontSize: 14, fontWeight: '700', flexShrink: 1, marginLeft: 16 },
  whenRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  whenBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center' },
  whenOn: { backgroundColor: '#5B4BFF' },
  whenT: { color: '#A6A6B8', fontSize: 14, fontWeight: '700' },
  whenTOn: { color: '#fff' },
  bookBox: { marginBottom: 16 },
  bookLabel: { color: '#8A8A98', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10 },
  contactBox: { marginTop: 16, marginBottom: 4 },
  contactInput: { backgroundColor: '#F4F2EE', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: '#1A1712', marginBottom: 10 },
  chip: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', marginRight: 8 },
  slotGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  slot: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  chipOn: { backgroundColor: '#5B4BFF' },
  chipT: { color: '#C6C6D2', fontSize: 13.5, fontWeight: '700' },
  chipTOn: { color: '#fff' },
  postBtn: { backgroundColor: '#16B77E', borderRadius: 14, paddingVertical: 17, alignItems: 'center' },
  postT: { color: '#fff', fontSize: 15.5, fontWeight: '800' },
  backCenter: { color: '#8A8A98', fontSize: 13.5, textAlign: 'center', fontWeight: '600' },
  err: { color: '#FF5A5F', fontSize: 13, marginTop: 12, textAlign: 'center' },
});
