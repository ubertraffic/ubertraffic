// VehiclesScreen.js — "My rig": the user's vehicles, each with its own registration + insurance
// and expiries. Reachable from Account for both workers and companies. Self-contained. Props: onClose()
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { listMyVehicles, saveMyVehicle, removeMyVehicle, VEHICLE_TYPES } from './vehiclesService';
import { setVehicle, getMyProfile } from './operatorService';
import { formatDMY, dmyToISO, isoToDMY } from './dateFormat';
import { C, S, R, T, shadowSm } from './theme';

// Road vehicles that can be "shown on jobs" (the one the client/worker cards + tracker display).
// Plant (excavator/bobcat) is a capability, not the driving vehicle, so it's excluded here.
const ROAD_TYPES = ['Ute', 'Van', 'Truck', 'Tipper', 'Trailer', 'Car', 'Other'];
const isRoad = (t) => ROAD_TYPES.includes(t);
// The label shown across the app (cards, live tracker, profile) — it's stored in profiles.vehicle_type.
const vehicleLabel = (v) => (v.make_model && v.make_model.trim()) ? `${v.type} · ${v.make_model.trim()}` : v.type;

const todayISO = () => new Date().toISOString().slice(0, 10);
// Returns { label, color } for an expiry date (null = not provided).
function expiryStatus(iso) {
  if (!iso) return null;
  const today = todayISO();
  if (iso < today) return { label: 'Expired', color: C.red };
  // within ~30 days = expiring soon
  const soon = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
  if (iso <= soon) return { label: `Due ${isoToDMY(iso)}`, color: C.amber };
  return { label: `Valid to ${isoToDMY(iso)}`, color: C.green };
}

export default function VehiclesScreen({ onClose }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);   // vehicle being added/edited, or null
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [activeLabel, setActiveLabel] = useState(null);   // profiles.vehicle_type = the one shown on jobs

  // form fields
  const [fType, setFType] = useState('Ute');
  const [fMakeModel, setFMakeModel] = useState('');
  const [fRego, setFRego] = useState('');
  const [fRegoExp, setFRegoExp] = useState('');
  const [fInsurer, setFInsurer] = useState('');
  const [fInsExp, setFInsExp] = useState('');

  const load = useCallback(async () => {
    try { setList(await listMyVehicles()); } catch (e) { setMsg(e.message || String(e)); setList([]); }
    try { const p = await getMyProfile(); setActiveLabel(p?.vehicle_type || null); } catch (_) {}
  }, []);
  useEffect(() => { load(); }, [load]);

  // Make this vehicle the one shown on jobs (syncs profiles.vehicle_type, which every card/tracker/
  // profile reads). Best-effort: if the column rejects the label it never blocks the screen.
  async function showOnJobs(v) {
    const label = vehicleLabel(v);
    setBusy(true); setMsg('');
    try { await setVehicle(label); setActiveLabel(label); }
    catch (_) { setMsg('Couldn’t set that as your job vehicle — try again.'); }
    finally { setBusy(false); }
  }

  function openAdd() {
    setEditing('new'); setMsg('');
    setFType('Ute'); setFMakeModel(''); setFRego(''); setFRegoExp(''); setFInsurer(''); setFInsExp('');
  }
  function openEdit(v) {
    setEditing(v.id); setMsg('');
    setFType(v.type || 'Ute'); setFMakeModel(v.make_model || ''); setFRego(v.rego || '');
    setFRegoExp(isoToDMY(v.rego_expires)); setFInsurer(v.insurer || ''); setFInsExp(isoToDMY(v.insurance_expires));
  }

  async function save() {
    // expiries optional, but if entered must be a real DD/MM/YYYY
    let regoISO = null, insISO = null;
    if (fRegoExp.trim()) { regoISO = dmyToISO(fRegoExp.trim()); if (!regoISO) { setMsg('Rego expiry must be DD/MM/YYYY.'); return; } }
    if (fInsExp.trim()) { insISO = dmyToISO(fInsExp.trim()); if (!insISO) { setMsg('Insurance expiry must be DD/MM/YYYY.'); return; } }
    setBusy(true); setMsg('');
    try {
      await saveMyVehicle({
        id: editing === 'new' ? undefined : editing,
        type: fType, make_model: fMakeModel, rego: fRego,
        rego_expires: regoISO, insurer: fInsurer, insurance_expires: insISO,
      });
      // If they have no vehicle shown on jobs yet, make this new road vehicle the one — so the app
      // stops saying the hardcoded 'ute' and shows what they actually drive. Best-effort.
      if (editing === 'new' && isRoad(fType) && !activeLabel) {
        const label = (fMakeModel && fMakeModel.trim()) ? `${fType} · ${fMakeModel.trim()}` : fType;
        try { await setVehicle(label); } catch (_) {}
      }
      setEditing(null);
      await load();
    } catch (e) { setMsg(e.message || String(e)); } finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true); setMsg('');
    try { await removeMyVehicle(id); await load(); } catch (e) { setMsg(e.message || String(e)); } finally { setBusy(false); }
  }

  if (list == null) return <View style={s.center}><ActivityIndicator color={C.indigo} /></View>;

  // ── add / edit form ──
  if (editing) {
    return (
      <View style={s.screen}>
        <View style={s.head}>
          <TouchableOpacity onPress={() => setEditing(null)}><Text style={s.back}>‹ Back</Text></TouchableOpacity>
          <Text style={s.h1}>{editing === 'new' ? 'Add a vehicle' : 'Edit vehicle'}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Text style={s.label}>Type</Text>
          <View style={s.chipRow}>
            {VEHICLE_TYPES.map((t) => (
              <TouchableOpacity key={t} style={[s.typeChip, fType === t && s.typeChipOn]} onPress={() => setFType(t)}>
                <Text style={[s.typeChipT, fType === t && s.typeChipTOn]}>{t}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.label}>Make & model <Text style={s.opt}>(optional)</Text></Text>
          <TextInput style={s.input} value={fMakeModel} onChangeText={setFMakeModel} placeholder="e.g. Toyota HiLux" placeholderTextColor={C.mute2} />

          <Text style={s.label}>Registration (rego) <Text style={s.opt}>(optional)</Text></Text>
          <TextInput style={s.input} value={fRego} onChangeText={setFRego} placeholder="e.g. ABC123" placeholderTextColor={C.mute2} autoCapitalize="characters" />

          <Text style={s.label}>Rego expiry <Text style={s.opt}>(optional)</Text></Text>
          <TextInput style={s.input} value={fRegoExp} onChangeText={(t) => setFRegoExp(formatDMY(t))} placeholder="DD/MM/YYYY" placeholderTextColor={C.mute2} keyboardType="number-pad" />

          <Text style={s.label}>Insurer <Text style={s.opt}>(optional)</Text></Text>
          <TextInput style={s.input} value={fInsurer} onChangeText={setFInsurer} placeholder="e.g. Allianz, NRMA" placeholderTextColor={C.mute2} />

          <Text style={s.label}>Insurance expiry <Text style={s.opt}>(optional)</Text></Text>
          <TextInput style={s.input} value={fInsExp} onChangeText={(t) => setFInsExp(formatDMY(t))} placeholder="DD/MM/YYYY" placeholderTextColor={C.mute2} keyboardType="number-pad" />

          {!!msg && <Text style={s.err}>{msg}</Text>}
          <TouchableOpacity style={[s.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={save}>
            <Text style={s.primaryT}>{busy ? 'Saving…' : 'Save vehicle'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  // ── list ──
  return (
    <View style={s.screen}>
      <View style={s.head}>
        {onClose && <TouchableOpacity onPress={onClose}><Text style={s.back}>‹ Done</Text></TouchableOpacity>}
        <Text style={s.h1}>Vehicles</Text>
        <Text style={s.tier}>Your rig — each vehicle carries its own rego and insurance.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }}>
        {!!msg && <Text style={s.err}>{msg}</Text>}
        {list.length === 0 ? (
          <Text style={[T.small, { color: C.mute, marginBottom: 16, lineHeight: 19 }]}>
            No vehicles yet. Add your ute, van or truck so jobs that need a vehicle can match you — and keep your rego and insurance dates in one place.
          </Text>
        ) : list.map((v) => {
          const rego = expiryStatus(v.rego_expires);
          const ins = expiryStatus(v.insurance_expires);
          return (
            <View key={v.id} style={s.card}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Text style={s.vType}>{v.type}{v.make_model ? <Text style={s.vModel}>  ·  {v.make_model}</Text> : null}</Text>
                  {v.rego ? <Text style={s.vRego}>{v.rego}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => openEdit(v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={s.edit}>Edit</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => remove(v.id)} disabled={busy} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Text style={s.rm}>✕</Text></TouchableOpacity>
              </View>
              {(rego || ins) ? (
                <View style={s.statusRow}>
                  {rego ? <View style={[s.pill, { backgroundColor: rego.color + '1A' }]}><Text style={[s.pillT, { color: rego.color }]}>Rego · {rego.label}</Text></View> : null}
                  {ins ? <View style={[s.pill, { backgroundColor: ins.color + '1A' }]}><Text style={[s.pillT, { color: ins.color }]}>Insurance · {ins.label}</Text></View> : null}
                </View>
              ) : <Text style={s.noDates}>No rego / insurance dates added</Text>}
              {/* "shown on jobs" — the vehicle the app displays on your job cards, tracker & profile */}
              {isRoad(v.type) && (
                activeLabel === vehicleLabel(v)
                  ? <View style={s.shownRow}><Text style={s.shownT}>✓ Shown on your jobs</Text></View>
                  : <TouchableOpacity style={s.showBtn} onPress={() => showOnJobs(v)} disabled={busy}>
                      <Text style={s.showBtnT}>Show this one on my jobs</Text>
                    </TouchableOpacity>
              )}
            </View>
          );
        })}

        <TouchableOpacity style={s.addBtn} onPress={openAdd} activeOpacity={0.9}>
          <Text style={s.addBtnT}>+ Add a vehicle</Text>
        </TouchableOpacity>

        <Text style={s.footNote}>Machines you operate (excavator, bobcat) can also be added as a capability on your home screen. Insurance you hold as a person (public liability) lives under Tickets & expiry.</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { paddingHorizontal: S.xl, paddingTop: 48, paddingBottom: 12 },
  back: { color: C.indigo, fontWeight: '600', fontSize: 15, marginBottom: 10 },
  h1: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: C.ink },
  tier: { fontSize: 13, color: C.mute, marginTop: 4, lineHeight: 18 },
  card: { backgroundColor: C.panel, borderRadius: R.lg, padding: 14, marginBottom: 12, ...shadowSm },
  vType: { fontSize: 16, fontWeight: '800', color: C.ink },
  vModel: { fontSize: 14, fontWeight: '600', color: C.mute },
  vRego: { fontSize: 13, fontWeight: '700', color: C.mute, marginTop: 3, letterSpacing: 1 },
  edit: { fontSize: 13, fontWeight: '700', color: C.indigo, paddingHorizontal: 8 },
  rm: { fontSize: 16, color: C.mute2, paddingHorizontal: 4 },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  pill: { borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  pillT: { fontSize: 12, fontWeight: '800' },
  noDates: { fontSize: 12, color: C.mute2, marginTop: 10, fontWeight: '600' },
  shownRow: { marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  shownT: { fontSize: 12.5, fontWeight: '800', color: C.green },
  showBtn: { marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  showBtnT: { fontSize: 12.5, fontWeight: '700', color: C.indigo },
  addBtn: { borderWidth: 1.5, borderColor: C.indigo, borderRadius: R.md, paddingVertical: 14, alignItems: 'center', marginTop: 6 },
  addBtnT: { color: C.indigo, fontWeight: '800', fontSize: 15 },
  footNote: { fontSize: 12, color: C.mute2, marginTop: 20, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '700', color: C.mute, marginBottom: 6, marginTop: 16 },
  opt: { fontWeight: '600', color: C.mute2 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.ink },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 },
  typeChipOn: { borderColor: C.indigo, backgroundColor: C.indigo + '12' },
  typeChipT: { fontSize: 13.5, fontWeight: '700', color: C.mute },
  typeChipTOn: { color: C.indigo },
  err: { color: C.red, fontSize: 13, marginBottom: 10, marginTop: 6 },
  primary: { backgroundColor: C.indigo, borderRadius: R.lg, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  primaryT: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
