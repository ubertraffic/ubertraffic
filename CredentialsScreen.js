// CredentialsScreen.js — operator manages their tickets & licences (Pillar 2).
// Self-contained. Props: onClose()
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { listCredentialTypes, listMyCredentials, addMyCredential, removeMyCredential, verifyMyCredential } from './credentialsService';
import { getMyProfile } from './operatorService';
import { setMyAbn, abnValid, normalizeAbn } from './accountService';
import { C, MONO, S, R, T, shadowSm } from './theme';
import Icon from './Icon';

const formatAbn = (clean) => (clean || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');

const TIER_LABEL = { baseline: 'Baseline', ticket: 'Ticket', hrwl: 'High Risk Licence', induction: 'Induction', licence: 'Trade licence', insurance: 'Insurance' };
const todayISO = () => new Date().toISOString().slice(0, 10);
// display status: self-declared cover expired past its date shows Expired even when 'unverified'.
const displayStatus = (held) => (held && held.expires_at && held.expires_at < todayISO()) ? 'expired' : (held ? held.status : 'none');
const STATUS_COLOR = { verified: C.green, unverified: C.amber, expired: C.red, suspended: C.red, review: C.amber, none: C.mute };
const STATUS_LABEL = { verified: '✓ Verified', unverified: 'Unverified', expired: 'Expired', suspended: 'Suspended', review: 'In review' };

export default function CredentialsScreen({ onClose }) {
  const [types, setTypes] = useState(null);
  const [mine, setMine] = useState([]);
  const [caps, setCaps] = useState(null);   // { can_work, can_task } — what tickets unlock
  const [adding, setAdding] = useState(null);   // credential_type being added
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [provider, setProvider] = useState('');   // insurer/provider (only for needs_provider types)
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [verifying, setVerifying] = useState(null);   // id being verified
  const [abnSaved, setAbnSaved] = useState(null);     // stored ABN (digits) or null
  const [abnInput, setAbnInput] = useState('');
  const [abnBusy, setAbnBusy] = useState(false);
  const [abnMsg, setAbnMsg] = useState('');

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
      if (res && res.status === 'verified') setMsg('✓ Verified against the NSW register.');
      else setMsg(res && res.detail ? `Sent for review: ${res.detail}` : 'Sent for manual review.');
      await refresh();
    } catch (e) { setMsg('Verify failed: ' + (e.message || String(e))); } finally { setVerifying(null); }
  }

  const refresh = useCallback(async () => {
    try {
      const [t, m, p] = await Promise.all([listCredentialTypes(), listMyCredentials(), getMyProfile().catch(() => null)]);
      setTypes(t); setMine(m);
      if (p) { setCaps({ can_work: p.can_work, can_task: p.can_task }); setAbnSaved(p.abn || null); }
    } catch (e) { setMsg(e.message || String(e)); setTypes([]); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const heldById = {};
  mine.forEach((c) => { heldById[c.credential_id] = c; });

  async function save() {
    if (!adding) return;
    setBusy(true); setMsg('');
    try {
      await addMyCredential({ credential_id: adding.id, number, expires_at: expiry || null, provider });
      setAdding(null); setNumber(''); setExpiry(''); setProvider('');
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
          <TouchableOpacity onPress={() => { setAdding(null); setNumber(''); setExpiry(''); setProvider(''); }}><Text style={styles.back}>‹ Back</Text></TouchableOpacity>
          <Text style={styles.h1}>{adding.name}</Text>
          <Text style={styles.tier}>{adding.needs_provider ? 'Insurance' : adding.self_declared ? 'Trade licence' : (TIER_LABEL[adding.tier] || adding.tier)}{adding.renews_years ? ` · renews every ${adding.renews_years}yr` : ''}</Text>
        </View>
        <ScrollView contentContainerStyle={{ padding: S.xl }}>
          {adding.needs_provider && (
            <>
              <Text style={styles.label}>Insurer / provider</Text>
              <TextInput style={styles.input} value={provider} onChangeText={setProvider} placeholder="e.g. Allianz, CGU" placeholderTextColor={C.mute2} />
            </>
          )}
          <Text style={styles.label}>{adding.needs_provider ? 'Policy number' : 'Card / licence number'}</Text>
          <TextInput style={styles.input} value={number} onChangeText={setNumber} placeholder={adding.needs_provider ? 'e.g. POL-12345678' : 'e.g. 1234-5678'} placeholderTextColor={C.mute2} autoCapitalize="characters" />
          <Text style={styles.label}>Expiry date{adding.needs_provider ? '' : ' (optional)'}</Text>
          <TextInput style={styles.input} value={expiry} onChangeText={setExpiry} placeholder="YYYY-MM-DD" placeholderTextColor={C.mute2} />
          <Text style={styles.hint}>{adding.self_declared
            ? "Saved as self-declared — we record what you enter and flag it as expired past its date. We don't verify it against a register."
            : "You'll be able to upload a photo of the card and get it verified. For now it's saved as unverified — verified tickets unlock high-risk jobs."}</Text>
          {!!msg && <Text style={styles.err}>{msg}</Text>}
          <TouchableOpacity style={[styles.primary, busy && { opacity: 0.6 }]} onPress={save} disabled={busy}>
            <Text style={styles.primaryText}>{busy ? 'Saving…' : 'Save credential'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        {onClose && <TouchableOpacity onPress={onClose}><Text style={styles.back}>‹ Done</Text></TouchableOpacity>}
        <Text style={styles.h1}>Tickets & expiry</Text>
        <Text style={styles.tier}>Verified tickets unlock the jobs that require them.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }}>
        {caps && (
          <View style={styles.capBanner}>
            <View style={styles.capRow}>
              <Text style={styles.capIcon}>{caps.can_work ? '✓' : '○'}</Text>
              <Text style={[styles.capText, caps.can_work && styles.capOn]}>
                {caps.can_work ? 'Cleared for site work' : 'Add a verified White Card to work sites'}
              </Text>
            </View>
            <View style={styles.capRow}>
              <Text style={styles.capIcon}>{caps.can_task ? '✓' : '○'}</Text>
              <Text style={[styles.capText, caps.can_task && styles.capOn]}>
                {caps.can_task ? 'Cleared for driving tasks' : 'Add a verified licence + vehicle for tasks'}
              </Text>
            </View>
          </View>
        )}
        {/* ABN — contractor status. Format + checksum only (honest: NOT register-verified).
            Non-blocking: a nudge, never a gate. Register verification is a deferred server-side step. */}
        <View style={styles.abnCard}>
          <Text style={styles.abnLabel}>Your ABN</Text>
          {abnSaved ? (
            <View style={styles.abnRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.abnValue}>{formatAbn(abnSaved)}</Text>
                <Text style={styles.abnOk}>✓ Valid format · full ABR check coming</Text>
              </View>
              <TouchableOpacity onPress={() => { setAbnInput(abnSaved); setAbnSaved(null); setAbnMsg(''); }}>
                <Text style={styles.abnEdit}>Edit</Text>
              </TouchableOpacity>
            </View>
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
                style={[styles.abnSave, (!abnValid(abnInput) || abnBusy) && { opacity: 0.5 }]}
                disabled={!abnValid(abnInput) || abnBusy}
                onPress={saveAbn}
              >
                <Text style={styles.abnSaveT}>{abnBusy ? 'Saving…' : 'Save ABN'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {!!msg && <Text style={styles.err}>{msg}</Text>}
        {types.map((t) => {
          const held = heldById[t.id];
          return (
            <View key={t.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{t.name}</Text>
                <Text style={styles.sub}>{t.needs_provider ? 'Insurance' : t.self_declared ? 'Trade licence' : (TIER_LABEL[t.tier] || t.tier)}{held && held.provider ? ` · ${held.provider}` : ''}{held && held.expires_at ? ` · exp ${held.expires_at}` : ''}</Text>
              </View>
              {held ? (
                <View style={styles.heldRight}>
                  {/* self-declared cover (insurance/licence) isn't register-verified in this build */}
                  {held.status !== 'verified' && !t.self_declared && (
                    <TouchableOpacity
                      style={styles.verifyBtn}
                      onPress={() => verify(held.id)}
                      disabled={verifying === held.id}
                    >
                      <Text style={styles.verifyText}>{verifying === held.id ? '…' : 'Verify'}</Text>
                    </TouchableOpacity>
                  )}
                  {(() => {
                    const ds = displayStatus(held);
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
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  head: { paddingHorizontal: S.xl, paddingTop: 48, paddingBottom: 12 },
  back: { color: C.indigo, fontWeight: '600', fontSize: 15, marginBottom: 10 },
  h1: { fontSize: 24, fontWeight: '800', letterSpacing: -0.5, color: C.ink },
  tier: { fontSize: 13, color: C.mute, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8 },
  name: { fontSize: 14.5, fontWeight: '600', color: C.ink },
  sub: { fontSize: 11, color: C.mute2, marginTop: 2, fontFamily: MONO },
  heldRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  verifyBtn: { backgroundColor: C.indigo, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 7 },
  verifyText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  statusPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  abnCard: { backgroundColor: C.panel, borderRadius: R.lg, padding: 14, marginBottom: 18, ...shadowSm },
  abnLabel: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  abnRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  abnValue: { fontSize: 17, fontWeight: '800', color: C.ink, fontFamily: MONO, letterSpacing: 0.5 },
  abnOk: { fontSize: 12, color: C.green, fontWeight: '700', marginTop: 3 },
  abnEdit: { fontSize: 13, fontWeight: '700', color: C.indigo },
  abnHint: { fontSize: 13, color: C.mute, lineHeight: 18, marginBottom: 10 },
  abnLink: { color: C.indigo, fontWeight: '700' },
  abnSave: { backgroundColor: C.indigo, borderRadius: R.md, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  abnSaveT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  capBanner: { backgroundColor: C.panel, borderRadius: R.lg, padding: 14, marginBottom: 18, gap: 8, ...shadowSm },
  capRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  capIcon: { fontSize: 15, fontWeight: '800', color: C.mute, width: 18, textAlign: 'center' },
  capText: { fontSize: 13.5, color: C.mute, fontWeight: '600', flex: 1 },
  capOn: { color: C.green, fontWeight: '700' },
  statusText: { fontSize: 10.5, fontWeight: '700', fontFamily: MONO, letterSpacing: 0.3 },
  rm: { color: C.mute2, fontSize: 15, paddingHorizontal: 4 },
  addBtn: { backgroundColor: C.indigo + '14', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  addText: { color: C.indigo, fontWeight: '700', fontSize: 13 },
  label: { fontSize: 12, fontWeight: '600', color: C.mute, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.ink },
  hint: { fontSize: 12, color: C.mute2, marginTop: 14, lineHeight: 17 },
  err: { color: C.red, fontSize: 13, marginBottom: 10 },
  primary: { backgroundColor: C.indigo, borderRadius: R.lg, padding: 16, alignItems: 'center', marginTop: 20 },
  primaryText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
