// CredentialsScreen.js — operator manages their tickets & licences (Pillar 2).
// Self-contained. Props: onClose()
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { listCredentialTypes, listMyCredentials, addMyCredential, removeMyCredential, verifyMyCredential, isAutoVerifiable } from './credentialsService';
import CredentialEvidence from './CredentialEvidence';
import { getMyProfile } from './operatorService';
import { setMyAbn, abnValid, normalizeAbn, setMyIdentity, verifyMyAbn, getMyIdentity } from './accountService';
import { formatDMY, dmyToISO, isoToDMY } from './dateFormat';
import { C, MONO, S, R, T, shadowSm } from './theme';
import Icon from './Icon';

const formatAbn = (clean) => (clean || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');

const TIER_LABEL = { baseline: 'Baseline', ticket: 'Ticket', hrwl: 'High Risk Licence', induction: 'Induction', licence: 'Trade licence', insurance: 'Insurance' };
// "Add more" folders, in order. Everything you DON'T already hold gets tucked into one of these,
// collapsed by default, so the screen opens short instead of listing 40 tickets at once.
const CATS = [
  { key: 'baseline', label: 'The basics', sub: 'White Card, driver licence' },
  { key: 'ticket', label: 'Tickets', sub: 'Traffic control, rail, asbestos…' },
  { key: 'induction', label: 'Inductions', sub: 'Site & safety inductions' },
  { key: 'licence', label: 'Trade licences', sub: 'Your trade qualifications' },
  { key: 'hrwl', label: 'High-risk work licences', sub: 'Cranes, rigging, scaffolding…' },
  { key: 'insurance', label: 'Insurance', sub: 'Public liability & more' },
];
const catOf = (t) => (t.needs_provider ? 'insurance' : (t.self_declared ? 'licence' : (t.tier || 'ticket')));
const todayISO = () => new Date().toISOString().slice(0, 10);
const validDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00').getTime());
// display status: self-declared cover expired past its date shows Expired even when 'unverified'.
const displayStatus = (held) => (held && held.expires_at && held.expires_at < todayISO()) ? 'expired' : (held ? held.status : 'none');
const STATUS_COLOR = { verified: C.green, unverified: C.amber, expired: C.red, suspended: C.red, review: C.amber, none: C.mute };
const STATUS_LABEL = { verified: '✓ Verified', unverified: 'Added', expired: 'Expired', suspended: 'Suspended', review: 'Checking' };

export default function CredentialsScreen({ onClose }) {
  const [types, setTypes] = useState(null);
  const [mine, setMine] = useState([]);
  const [caps, setCaps] = useState(null);   // { can_work, can_task } — what tickets unlock
  const [adding, setAdding] = useState(null);   // credential_type being added
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [provider, setProvider] = useState('');   // insurer/provider (only for needs_provider types)
  const [cardNumber, setCardNumber] = useState('');   // card number (licences: separate from licence number)
  const [credState, setCredState] = useState('NSW');  // issuing state/jurisdiction (licences)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [verifying, setVerifying] = useState(null);   // id being verified
  const [evidenceFor, setEvidenceFor] = useState(null);   // credential_type id whose photo panel is open
  const [openCat, setOpenCat] = useState({});             // which "add more" folder is expanded (collapsed by default)
  const [abnSaved, setAbnSaved] = useState(null);     // stored ABN (digits) or null
  const [abnStatus, setAbnStatus] = useState(null);   // 'valid' | 'verified' | null
  const [abnInput, setAbnInput] = useState('');
  const [abnBusy, setAbnBusy] = useState(false);
  const [abnMsg, setAbnMsg] = useState('');

  async function verifyAbn() {
    setAbnBusy(true); setAbnMsg('');
    try {
      const r = await verifyMyAbn();
      if (r && r.status === 'verified') { setAbnStatus('verified'); setAbnMsg('✓ Your ABN is confirmed.'); }
      else setAbnMsg(r && r.detail ? r.detail : 'Added — we’ll take a closer look for you.');
    } catch (e) { setAbnMsg('Couldn’t check that just now — please try again.'); } finally { setAbnBusy(false); }
  }
  const [idSaved, setIdSaved] = useState(null);       // { legal_name, date_of_birth } or null
  const [idEditing, setIdEditing] = useState(false);
  const [idName, setIdName] = useState('');
  const [idDob, setIdDob] = useState('');
  const [idBusy, setIdBusy] = useState(false);
  const [idMsg, setIdMsg] = useState('');

  async function saveIdentity() {
    const iso = dmyToISO(idDob);
    if (!iso) { setIdMsg('Enter your date of birth as DD/MM/YYYY.'); return; }
    setIdBusy(true); setIdMsg('');
    try {
      const r = await setMyIdentity(idName, iso);
      setIdSaved({ legal_name: r.legal_name, date_of_birth: r.date_of_birth });
      setIdEditing(false);
    } catch (e) { setIdMsg(e.message || String(e)); } finally { setIdBusy(false); }
  }

  async function saveAbn() {
    setAbnBusy(true); setAbnMsg('');
    try {
      const r = await setMyAbn(abnInput);
      setAbnSaved(r.abn); setAbnInput('');
    } catch (e) { setAbnMsg(e.message || String(e)); } finally { setAbnBusy(false); }
  }

  async function verify(id) {
    setVerifying(id); setMsg('');
    try {
      const res = await verifyMyCredential(id);
      if (res && res.status === 'verified') setMsg('✓ Verified.');
      else setMsg(res && res.detail ? res.detail : 'Added — we’ll check this one for you.');
      await refresh();
    } catch (e) { setMsg('Couldn’t check that just now — please try again.'); } finally { setVerifying(null); }
  }

  const refresh = useCallback(async () => {
    try {
      // capabilities from the profile; the sensitive identity/ABN PII comes from the definer function
      // (those columns are column-REVOKEd on profiles — 0067 — so a direct select can't read them).
      const [t, m, p, id] = await Promise.all([
        listCredentialTypes(), listMyCredentials(),
        getMyProfile().catch(() => null), getMyIdentity().catch(() => ({})),
      ]);
      setTypes(t); setMine(m);
      if (p) setCaps({ can_work: p.can_work, can_task: p.can_task });
      setAbnSaved(id.abn || null);
      setAbnStatus(id.abn_status || (p && p.abn_status) || null);
      setIdSaved(id.legal_name ? { legal_name: id.legal_name, date_of_birth: id.date_of_birth } : null);
    } catch (e) { setMsg(e.message || String(e)); setTypes([]); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const heldById = {};
  mine.forEach((c) => { heldById[c.credential_id] = c; });

  // One row — reused for the "on file" list and inside the collapsible "add more" folders.
  function renderRow(t) {
    const held = heldById[t.id];
    const ds = displayStatus(held);
    const autoVerify = isAutoVerifiable(t);
    // Photo-evidence path: held, not yet verified, and NO free register check.
    const canEvidence = held && ds !== 'verified' && !autoVerify;
    return (
      <View key={t.id}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{t.name}</Text>
            <Text style={styles.sub}>{t.needs_provider ? 'Insurance' : t.self_declared ? 'Trade licence' : (TIER_LABEL[t.tier] || t.tier)}{held && held.provider ? ` · ${held.provider}` : ''}{held && held.expires_at ? ` · exp ${isoToDMY(held.expires_at)}` : ''}</Text>
          </View>
          {held ? (
            <View style={styles.heldRight}>
              {held.status !== 'verified' && autoVerify && (
                <TouchableOpacity style={styles.verifyBtn} onPress={() => verify(held.id)} disabled={verifying === held.id}>
                  <Text style={styles.verifyText}>{verifying === held.id ? '…' : 'Check'}</Text>
                </TouchableOpacity>
              )}
              {canEvidence && (
                <TouchableOpacity style={styles.photoBtn} onPress={() => setEvidenceFor(evidenceFor === t.id ? null : t.id)}>
                  <Text style={styles.photoBtnT}>{held.evidence_url ? '📷 ✓' : '📷 ID'}</Text>
                </TouchableOpacity>
              )}
              {(() => {
                const selfDecl = !!t.self_declared;
                const label = ds === 'expired' ? 'Expired' : (selfDecl && ds === 'unverified' ? 'On file' : (STATUS_LABEL[ds] || ds));
                const color = ds === 'expired' ? C.red : (selfDecl && ds === 'unverified' ? C.mute : (STATUS_COLOR[ds] || C.mute));
                return (
                  <View style={[styles.statusPill, { backgroundColor: color + '1A' }]}>
                    <Text style={[styles.statusText, { color }]}>{label}</Text>
                  </View>
                );
              })()}
              <TouchableOpacity onPress={() => remove(held.id)}><Text style={styles.rm}>✕</Text></TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(t)}>
              <Text style={styles.addText}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>
        {canEvidence && evidenceFor === t.id && (
          <CredentialEvidence credentialId={t.id} existingPath={held.evidence_url} onDone={() => refresh()} />
        )}
      </View>
    );
  }

  // Partition: what you hold (shown up top) vs what you could add (grouped into collapsible folders).
  // `types` is null until loaded — guard so we never .filter(null) before the loading return below.
  const typeList = types || [];
  const heldList = typeList.filter((t) => heldById[t.id]);
  const notHeldByCat = {};
  typeList.filter((t) => !heldById[t.id]).forEach((t) => { const k = catOf(t); (notHeldByCat[k] = notHeldByCat[k] || []).push(t); });
  const addCats = CATS.map((cat) => ({ cat, items: notHeldByCat[cat.key] || [] })).filter((g) => g.items.length > 0);

  function resetAddForm() { setAdding(null); setNumber(''); setExpiry(''); setProvider(''); setCardNumber(''); setCredState('NSW'); setMsg(''); }
  async function save() {
    if (!adding) return;
    // field-aware validation
    if (adding.requires_card_no && !cardNumber.trim()) { setMsg('This licence needs a card number.'); return; }
    let expiryISO = null;
    if (adding.expiry_rule !== 'none' && expiry.trim()) {
      expiryISO = dmyToISO(expiry.trim());
      if (!expiryISO) { setMsg('Enter the expiry as DD/MM/YYYY.'); return; }
    }
    if (adding.expiry_rule === 'required' && !expiryISO) { setMsg('This credential needs an expiry date.'); return; }
    setBusy(true); setMsg('');
    try {
      await addMyCredential({
        credential_id: adding.id,
        number,
        card_number: adding.requires_card_no ? cardNumber : null,
        expires_at: expiryISO,
        state: adding.requires_card_no ? credState : null,
        provider,
      });
      resetAddForm();
      await refresh();
    } catch (e) { setMsg(e.message || String(e)); } finally { setBusy(false); }
  }
  async function remove(id) {
    setBusy(true);
    try { await removeMyCredential(id); await refresh(); } catch (e) { setMsg(e.message || String(e)); } finally { setBusy(false); }
  }

  if (!types) return <View style={styles.center}><ActivityIndicator color={C.indigo} /></View>;

  // add form
  if (adding) {
    return (
      <View style={styles.screen}>
        <View style={styles.head}>
          <TouchableOpacity onPress={resetAddForm}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
          <Text style={styles.h1}>{adding.name}</Text>
          <Text style={styles.tier}>{adding.needs_provider ? 'Insurance' : adding.self_declared ? 'Trade licence' : (TIER_LABEL[adding.tier] || adding.tier)}{adding.renews_years ? ` · renews every ${adding.renews_years}yr` : ''}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: S.xl }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
          {adding.needs_provider && (
            <>
              <Text style={styles.label}>Insurer / provider</Text>
              <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder="e.g. Allianz, CGU" placeholderTextColor={C.mute2} />
            </>
          )}
          <Text style={styles.label}>{adding.needs_provider ? 'Policy number' : adding.requires_card_no ? 'Licence number' : 'Card / ticket number'}</Text>
          <TextInput style={styles.input} value={number} onChangeText={setNumber} placeholder={adding.needs_provider ? 'e.g. POL-12345678' : 'e.g. 1234 5678'} placeholderTextColor={C.mute2} autoCapitalize="characters" />
          {adding.requires_card_no && (
            <>
              <Text style={styles.label}>Card number</Text>
              <TextInput style={styles.input} value={cardNumber} onChangeText={setCardNumber} placeholder="the number printed on the card" placeholderTextColor={C.mute2} autoCapitalize="characters" />
              <Text style={styles.label}>Issuing state</Text>
              <View style={styles.stateRow}>
                {['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'ACT', 'NT'].map((st) => (
                  <TouchableOpacity key={st} style={[styles.stateChip, credState === st && styles.stateChipOn]} onPress={() => setCredState(st)}>
                    <Text style={[styles.stateChipT, credState === st && styles.stateChipTOn]}>{st}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}
          {adding.expiry_rule !== 'none' && (
            <>
              <Text style={styles.label}>Expiry date{adding.expiry_rule === 'required' ? '' : ' (optional)'}</Text>
              <TextInput style={styles.input} value={expiry} onChangeText={(t) => setExpiry(formatDMY(t))} placeholder="DD/MM/YYYY" placeholderTextColor={C.mute2} keyboardType="number-pad" />
            </>
          )}
          <Text style={styles.hint}>{adding.self_declared
            ? "We'll save this as you enter it and remind you before it expires. No register to check it against — just keep it current."
            : "Save it now, then check it or add a photo. Verified tickets open up the jobs that need them."}</Text>
          {!!msg && <Text style={styles.err}>{msg}</Text>}
          <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        {onClose && <TouchableOpacity onPress={onClose}><Text style={styles.back}>‹ Done</Text></TouchableOpacity>}
        <Text style={styles.h1}>Your tickets</Text>
        <Text style={styles.tier}>Add your White Card and any licences — verified ones open up more jobs.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 130 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {caps && (
          <View style={styles.capBanner}>
            <View style={styles.capRow}>
              <Text style={styles.capIcon}>{caps.can_work ? '✓' : '○'}</Text>
              <Text style={[styles.capText, caps.can_work && styles.capOn]}>
                {caps.can_work ? 'Cleared for site work' : 'Add your White Card to work on sites'}
              </Text>
            </View>
            <View style={styles.capRow}>
              <Text style={styles.capIcon}>{caps.can_task ? '✓' : '○'}</Text>
              <Text style={[styles.capText, caps.can_task && styles.capOn]}>
                {caps.can_task ? 'Cleared for driving tasks' : 'Add a licence + vehicle for driving tasks'}
              </Text>
            </View>
          </View>
        )}
        {/* Identity — legal name + DOB. The anchor a register/DVS check matches against. Sensitive PII. */}
        <View style={styles.abnCard}>
          <Text style={styles.abnLabel}>About you</Text>
          {idSaved && !idEditing ? (
            <View style={styles.abnRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.idDisplayName}>{idSaved.legal_name}</Text>
                <Text style={styles.abnOk}>DOB {isoToDMY(idSaved.date_of_birth) || '—'} · on file</Text>
              </View>
              <TouchableOpacity onPress={() => { setIdName(idSaved.legal_name || ''); setIdDob(isoToDMY(idSaved.date_of_birth)); setIdEditing(true); setIdMsg(''); }}>
                <Text style={styles.abnEdit}>Edit</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.abnHint}>Your full name and date of birth — used only to check your tickets, never shown to anyone.</Text>
              <Text style={styles.label}>Full legal name</Text>
              <TextInput style={styles.input} value={idName} onChangeText={setIdName} placeholder="As on your licence / White Card" placeholderTextColor={C.mute2} />
              <Text style={styles.label}>Date of birth</Text>
              <TextInput style={styles.input} value={idDob} onChangeText={(t) => setIdDob(formatDMY(t))} placeholder="DD/MM/YYYY" placeholderTextColor={C.mute2} keyboardType="number-pad" />
              {!!idMsg && <Text style={styles.err}>{idMsg}</Text>}
              <TouchableOpacity style={[styles.abnSave, idBusy && { opacity: 0.5 }]} disabled={idBusy} onPress={saveIdentity}>
                <Text style={styles.abnSaveT}>{idBusy ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* ABN — contractor status. Format + checksum only (honest: NOT register-verified).
            Non-blocking: a nudge, never a gate. Register verification is a deferred server-side step. */}
        <View style={styles.abnCard}>
          <Text style={styles.abnLabel}>Your ABN</Text>
          {abnSaved ? (
            <>
              <View style={styles.abnRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.abnValue}>{formatAbn(abnSaved)}</Text>
                  <Text style={[styles.abnOk, abnStatus !== 'verified' && { color: C.mute }]}>
                    {abnStatus === 'verified' ? '✓ Confirmed with the ABR' : 'Saved — not checked yet'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => { setAbnInput(abnSaved); setAbnSaved(null); setAbnMsg(''); }}>
                  <Text style={styles.abnEdit}>Edit</Text>
                </TouchableOpacity>
              </View>
              {abnStatus !== 'verified' && (
                <TouchableOpacity style={[styles.abnSave, abnBusy && { opacity: 0.5 }]} disabled={abnBusy} onPress={verifyAbn}>
                  <Text style={styles.abnSaveT}>{abnBusy ? 'Checking…' : 'Check my ABN'}</Text>
                </TouchableOpacity>
              )}
              {!!abnMsg && <Text style={[styles.hint, { marginTop: 8 }]}>{abnMsg}</Text>}
            </>
          ) : (
            <>
              <Text style={styles.abnHint}>
                Add your 11-digit ABN so you can be paid properly as a contractor. Not sure of it?{' '}
                <Text style={styles.abnLink} onPress={() => Linking.openURL('https://abr.gov.au')}>Look it up at abr.gov.au</Text>
              </Text>
              <TextInput
                style={styles.input}
                value={abnInput}
                onChangeText={(t) => setAbnInput(t.replace(/[^\d ]/g, '').slice(0, 14))}
                placeholder="12 345 678 901"
                placeholderTextColor={C.mute2}
                keyboardType="number-pad"
              />
              {normalizeAbn(abnInput).length === 11 && !abnValid(abnInput) ? (
                <Text style={styles.err}>That ABN doesn’t check out — double-check the number.</Text>
              ) : null}
              {!!abnMsg && <Text style={styles.err}>{abnMsg}</Text>}
              <TouchableOpacity
                style={[styles.abnSave, (abnBusy || !abnInput.trim()) && { opacity: 0.5 }]}
                disabled={abnBusy || !abnInput.trim()}
                onPress={saveAbn}
              >
                <Text style={styles.abnSaveT}>{abnBusy ? 'Saving…' : 'Save ABN'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {!!msg && <Text style={styles.err}>{msg}</Text>}

        {/* What you already hold — always visible, up top */}
        {heldList.length > 0 && (
          <>
            <Text style={styles.sectionH}>ON FILE</Text>
            {heldList.map(renderRow)}
          </>
        )}

        {/* Everything else, tucked into collapsible folders so the screen opens short */}
        {addCats.length > 0 && (
          <>
            <Text style={styles.sectionH}>ADD MORE</Text>
            {addCats.map(({ cat, items }) => {
              const open = !!openCat[cat.key];
              return (
                <View key={cat.key} style={styles.folder}>
                  <TouchableOpacity style={styles.folderHead} activeOpacity={0.7}
                    onPress={() => setOpenCat((p) => ({ ...p, [cat.key]: !open }))}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.folderTitle}>{cat.label}</Text>
                      <Text style={styles.folderSub}>{open ? cat.sub : `${items.length} ${items.length === 1 ? 'option' : 'options'}`}</Text>
                    </View>
                    <Text style={[styles.folderChev, open && { transform: [{ rotate: '90deg' }] }]}>›</Text>
                  </TouchableOpacity>
                  {open && <View style={styles.folderBody}>{items.map(renderRow)}</View>}
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { paddingHorizontal: S.xl, paddingTop: 22, paddingBottom: 16 },
  back: { color: C.mute, fontWeight: '700', fontSize: 14, marginBottom: 12 },
  h1: { fontSize: 27, fontWeight: '900', letterSpacing: -0.7, color: C.ink },
  tier: { fontSize: 13, color: C.mute, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  name: { fontSize: 14.5, fontWeight: '600', color: C.ink },
  sub: { fontSize: 11, color: C.mute2, marginTop: 2 },
  heldRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyBtn: { backgroundColor: C.indigo, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
  verifyText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  photoBtn: { borderWidth: 1.5, borderColor: C.line, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 7 },
  photoBtnT: { color: C.indigo, fontWeight: '700', fontSize: 12 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  abnCard: { backgroundColor: C.panel, borderRadius: R.lg, padding: 14, marginBottom: 18, ...shadowSm },
  abnLabel: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  abnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  abnValue: { fontSize: 17, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  abnOk: { fontSize: 12, color: C.green, fontWeight: '700', marginTop: 3 },
  abnEdit: { fontSize: 13, fontWeight: '700', color: C.indigo },
  idDisplayName: { fontSize: 16, fontWeight: '800', color: C.ink },
  abnHint: { fontSize: 13, color: C.mute, lineHeight: 18, marginBottom: 10 },
  abnLink: { color: C.indigo, fontWeight: '700' },
  abnSave: { backgroundColor: C.indigo, borderRadius: R.md, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  abnSaveT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  stateRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stateChip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  stateChipOn: { borderColor: C.indigo, backgroundColor: C.indigo + '12' },
  stateChipT: { fontSize: 13, fontWeight: '700', color: C.mute },
  stateChipTOn: { color: C.indigo },
  capBanner: { backgroundColor: C.panel, borderRadius: R.lg, padding: 14, marginBottom: 18, gap: 8, ...shadowSm },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  capIcon: { fontSize: 15, fontWeight: '800', color: C.mute, width: 18, textAlign: 'center' },
  capText: { fontSize: 13.5, color: C.mute, fontWeight: '600', flex: 1 },
  capOn: { color: C.green, fontWeight: '700' },
  statusText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.3 },
  rm: { color: C.mute2, fontSize: 15, paddingHorizontal: 4 },
  addBtn: { backgroundColor: C.indigo + '14', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addText: { color: C.indigo, fontWeight: '700', fontSize: 13 },
  label: { fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, paddingHorizontal: 16, paddingVertical: 15, fontSize: 16, color: C.ink, ...shadowSm },
  hint: { fontSize: 12, color: C.mute2, marginTop: 14, lineHeight: 17 },
  err: { color: C.red, fontSize: 13, marginBottom: 10 },
  primary: { backgroundColor: C.indigo, borderRadius: R.lg, padding: 16, alignItems: 'center', marginTop: 20 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  sectionH: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.8, marginTop: 8, marginBottom: 10 },
  folder: { backgroundColor: C.panel, borderRadius: R.lg, marginBottom: 10, ...shadowSm, overflow: 'hidden' },
  folderHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 16 },
  folderTitle: { fontSize: 15.5, fontWeight: '800', color: C.ink, letterSpacing: -0.2 },
  folderSub: { fontSize: 12.5, color: C.mute, marginTop: 3, fontWeight: '600' },
  folderChev: { fontSize: 24, color: C.mute2, fontWeight: '300', paddingHorizontal: 4 },
  folderBody: { paddingHorizontal: 10, paddingBottom: 8 },
});
