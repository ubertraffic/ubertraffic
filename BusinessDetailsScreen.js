// BusinessDetailsScreen.js — the hire side's mirror of the worker Credentials screen.
// The client manages the two things that make them a real, payable business on SiteCall:
//   • Company / trading name  (a label — no verification)
//   • Business ABN            (format + checksum locally; register verification is the hire gate)
// Self-contained. Props: onClose()
//
// Honest by design (CLAUDE.md): a locally-checked ABN reads "Valid format · not yet verified",
// NOT "verified". The only path to a verified badge is the server-side hire gate
// (submitBusinessAbn → pending → admin/ABR approves → company_verify_status='verified').
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Linking } from 'react-native';
import { getMyBusiness, setMyCompanyName, setMyCompanyAbn, submitBusinessAbn, abnValid, normalizeAbn } from './accountService';
import { C, MONO, S, R, T, shadowSm } from './theme';

const formatAbn = (clean) => (clean || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');

export default function BusinessDetailsScreen({ onClose }) {
  const [loaded, setLoaded] = useState(false);

  // company / trading name
  const [nameSaved, setNameSaved] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [nameBusy, setNameBusy] = useState(false);
  const [nameMsg, setNameMsg] = useState('');

  // business ABN
  const [abnSaved, setAbnSaved] = useState(null);       // stored digits or null
  const [abnStatus, setAbnStatus] = useState('none');   // company_verify_status: none | pending | verified
  const [abnInput, setAbnInput] = useState('');
  const [abnBusy, setAbnBusy] = useState(false);
  const [abnMsg, setAbnMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const b = await getMyBusiness();
      setNameSaved(b.company_name || '');
      setAbnSaved(b.company_abn || null);
      setAbnStatus(b.company_verify_status || 'none');
    } catch (_) {
      // fails soft — an un-migrated column shows the empty state, never a crash
    } finally { setLoaded(true); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  async function saveName() {
    setNameBusy(true); setNameMsg('');
    try { const r = await setMyCompanyName(nameInput); setNameSaved(r.company_name); setNameEditing(false); }
    catch (e) { setNameMsg(e.message || String(e)); } finally { setNameBusy(false); }
  }

  async function saveAbn() {
    setAbnBusy(true); setAbnMsg('');
    try { const r = await setMyCompanyAbn(abnInput); setAbnSaved(r.company_abn); setAbnInput(''); }
    catch (e) { setAbnMsg(e.message || String(e)); } finally { setAbnBusy(false); }
  }

  async function verifyAbn() {
    if (!abnSaved) return;
    setAbnBusy(true); setAbnMsg('');
    try {
      await submitBusinessAbn(abnSaved);
      setAbnStatus('pending');
      setAbnMsg('Submitted — we’ll check it against the business register.');
    } catch (e) { setAbnMsg(e.message || String(e)); } finally { setAbnBusy(false); }
  }

  if (!loaded) return <View style={styles.center}><ActivityIndicator color={C.indigo} /></View>;

  const abnStatusLine =
    abnStatus === 'verified' ? '✓ Verified against the business register'
    : abnStatus === 'pending' ? 'In review — checking against the register'
    : 'Valid format · not yet verified';

  return (
    <View style={styles.screen}>
      <View style={styles.head}>
        <TouchableOpacity onPress={onClose}><Text style={styles.back}>‹ Account</Text></TouchableOpacity>
        <Text style={styles.h1}>Business details</Text>
        <Text style={styles.tier}>Your company name and ABN — how you’re billed and paid on SiteCall.</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: S.xl, paddingBottom: 40 }} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>

        {/* Company / trading name */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Company / trading name</Text>
          {nameSaved && !nameEditing ? (
            <View style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.value}>{nameSaved}</Text></View>
              <TouchableOpacity onPress={() => { setNameInput(nameSaved); setNameEditing(true); setNameMsg(''); }}>
                <Text style={styles.edit}>Edit</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <Text style={styles.hint}>The name your workers and invoices see — your registered company or trading name.</Text>
              <TextInput style={styles.input} value={nameInput} onChangeText={setNameInput} placeholder="e.g. Santi Civil Pty Ltd" placeholderTextColor={C.mute2} maxLength={80} />
              {!!nameMsg && <Text style={styles.err}>{nameMsg}</Text>}
              <TouchableOpacity style={[styles.save, nameBusy && { opacity: 0.5 }]} disabled={nameBusy} onPress={saveName}>
                <Text style={styles.saveT}>{nameBusy ? 'Saving…' : 'Save name'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {/* Business ABN */}
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Business ABN</Text>
          {abnSaved ? (
            <>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.abnValue}>{formatAbn(abnSaved)}</Text>
                  <Text style={[styles.ok, abnStatus !== 'verified' && { color: C.mute }]}>{abnStatusLine}</Text>
                </View>
                <TouchableOpacity onPress={() => { setAbnInput(abnSaved); setAbnSaved(null); setAbnMsg(''); }}>
                  <Text style={styles.edit}>Edit</Text>
                </TouchableOpacity>
              </View>
              {abnStatus !== 'verified' && abnStatus !== 'pending' && (
                <TouchableOpacity style={[styles.save, abnBusy && { opacity: 0.5 }]} disabled={abnBusy} onPress={verifyAbn}>
                  <Text style={styles.saveT}>{abnBusy ? 'Submitting…' : 'Verify against the register'}</Text>
                </TouchableOpacity>
              )}
              {!!abnMsg && <Text style={[styles.hint, { marginTop: 8 }]}>{abnMsg}</Text>}
            </>
          ) : (
            <>
              <Text style={styles.hint}>
                Your 11-digit business ABN. Not sure of it?{' '}
                <Text style={styles.link} onPress={() => Linking.openURL('https://abr.gov.au')}>Look it up at abr.gov.au</Text>
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
                style={[styles.save, (!abnValid(abnInput) || abnBusy) && { opacity: 0.5 }]}
                disabled={!abnValid(abnInput) || abnBusy}
                onPress={saveAbn}
              >
                <Text style={styles.saveT}>{abnBusy ? 'Saving…' : 'Save ABN'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

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
  tier: { fontSize: 13, color: C.mute, marginTop: 4, lineHeight: 18 },
  card: { backgroundColor: C.panel, borderRadius: R.lg, padding: 14, marginBottom: 18, ...shadowSm },
  cardLabel: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  value: { fontSize: 16, fontWeight: '800', color: C.ink },
  abnValue: { fontSize: 17, fontWeight: '800', color: C.ink, letterSpacing: 0.5 },
  ok: { fontSize: 12, color: C.green, fontWeight: '700', marginTop: 3 },
  edit: { fontSize: 13, fontWeight: '700', color: C.indigo },
  hint: { fontSize: 13, color: C.mute, lineHeight: 18, marginBottom: 10 },
  link: { color: C.indigo, fontWeight: '700' },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.lg, paddingHorizontal: 16, paddingVertical: 15, fontSize: 16, color: C.ink, ...shadowSm },
  save: { backgroundColor: C.indigo, borderRadius: R.md, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  saveT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  err: { color: C.red, fontSize: 13, marginTop: 8, marginBottom: 2 },
});
