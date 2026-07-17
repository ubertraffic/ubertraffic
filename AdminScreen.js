// AdminScreen.js — the admin panel. Opens ONLY for admins (Account checks amIAdmin() server-side).
// Every button here calls a SECURITY DEFINER RPC that re-checks admin status in the database, so a
// non-admin who somehow reached this screen still can't do anything. Self-contained. Props: onClose()
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Image } from 'react-native';
import {
  adminOverview, adminPendingCredentials, adminDecideCredential, adminGrantCredential,
  adminRemoveCredential, adminUserCredentials, adminUserVehicles, adminPendingAbns, adminDecideAbn,
  adminSearchUsers, adminActiveJobs,
} from './adminService';
import { listCredentialTypes, credentialEvidenceUrl } from './credentialsService';
import { isoToDMY } from './dateFormat';
import { C, MONO, S, R, T, shadowSm } from './theme';

const formatAbn = (clean) => (clean || '').replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
const SECTIONS = [['reviews', 'Reviews'], ['abns', 'ABNs'], ['users', 'Users'], ['ops', 'Ops']];

export default function AdminScreen({ onClose }) {
  const [section, setSection] = useState('reviews');
  const [ov, setOv] = useState(null);

  const loadOverview = useCallback(async () => {
    try { setOv(await adminOverview()); } catch (_) { setOv({}); }
  }, []);
  useEffect(() => { loadOverview(); }, [loadOverview]);

  return (
    <View style={s.screen}>
      <View style={s.head}>
        <TouchableOpacity onPress={onClose}><Text style={s.back}>‹ Done</Text></TouchableOpacity>
        <Text style={s.h1}>Admin</Text>
      </View>

      {/* Overview stat strip */}
      <View style={s.stats}>
        <Stat n={ov?.pending_credentials} label="ID reviews" tone={C.amber} />
        <Stat n={ov?.pending_abns} label="ABNs" tone={C.amber} />
        <Stat n={ov?.workers_online} label="Online" tone={C.green} />
        <Stat n={ov?.active_jobs} label="Active" tone={C.indigo} />
      </View>

      {/* Section switch */}
      <View style={s.segRow}>
        {SECTIONS.map(([key, label]) => (
          <TouchableOpacity key={key} style={[s.seg, section === key && s.segOn]} onPress={() => setSection(key)}>
            <Text style={[s.segT, section === key && s.segTOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {section === 'reviews' ? <Reviews onChange={loadOverview} />
        : section === 'abns' ? <Abns onChange={loadOverview} />
        : section === 'users' ? <Users />
        : <Ops />}
    </View>
  );
}

function Stat({ n, label, tone }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statN, { color: tone }]}>{n == null ? '—' : n}</Text>
      <Text style={s.statL}>{label}</Text>
    </View>
  );
}

// ── Credential review queue ───────────────────────────────────────────────────
function Reviews({ onChange }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);   // row id being acted on
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    try { setRows(await adminPendingCredentials()); } catch (e) { setErr(e.message || String(e)); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(row, approve) {
    setBusy(row.id);
    try { await adminDecideCredential(row.id, approve); await load(); onChange && onChange(); }
    catch (e) { setErr(e.message || String(e)); } finally { setBusy(null); }
  }

  if (rows == null) return <Loading />;
  return (
    <ScrollView contentContainerStyle={s.body}>
      {!!err && <Text style={s.err}>{err}</Text>}
      {rows.length === 0 ? <Empty label="No credentials waiting for review." />
        : rows.map((r) => <ReviewCard key={r.id} r={r} busy={busy === r.id} onApprove={() => decide(r, true)} onReject={() => decide(r, false)} />)}
    </ScrollView>
  );
}

function ReviewCard({ r, busy, onApprove, onReject }) {
  const [photo, setPhoto] = useState(null);
  const [loadingPhoto, setLoadingPhoto] = useState(false);
  async function viewPhoto() {
    if (photo || !r.evidence_url) return;
    setLoadingPhoto(true);
    try { setPhoto(await credentialEvidenceUrl(r.evidence_url)); } catch (_) {} finally { setLoadingPhoto(false); }
  }
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>{r.cred_name || r.credential_id}</Text>
      <Text style={s.cardSub}>{r.legal_name || r.worker_name || 'Unnamed worker'}{r.date_of_birth ? ` · DOB ${r.date_of_birth}` : ''}</Text>
      {(r.number || r.card_number || r.state) ? (
        <Text style={s.cardMeta}>{[r.number && `No. ${r.number}`, r.card_number && `Card ${r.card_number}`, r.state].filter(Boolean).join(' · ')}</Text>
      ) : null}
      {r.expires_at ? <Text style={s.cardMeta}>Expires {r.expires_at}</Text> : null}
      <View style={[s.pill, { backgroundColor: C.amber + '1A', alignSelf: 'flex-start', marginTop: 6 }]}><Text style={[s.pillT, { color: C.amber }]}>{r.status}</Text></View>

      {r.evidence_url ? (
        photo ? <Image source={{ uri: photo }} style={s.evidence} resizeMode="cover" />
          : <TouchableOpacity style={s.ghostBtn} onPress={viewPhoto} disabled={loadingPhoto}>
              <Text style={s.ghostBtnT}>{loadingPhoto ? 'Loading…' : '📷 View photo ID'}</Text>
            </TouchableOpacity>
      ) : <Text style={s.cardMeta}>No photo uploaded.</Text>}

      <View style={s.rowBtns}>
        <TouchableOpacity style={[s.okBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={onApprove}>
          <Text style={s.okBtnT}>{busy ? '…' : '✓ Verify'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.noBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={onReject}>
          <Text style={s.noBtnT}>Reject</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── ABN reviews ───────────────────────────────────────────────────────────────
function Abns({ onChange }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setErr('');
    try { setRows(await adminPendingAbns()); } catch (e) { setErr(e.message || String(e)); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(row, approve) {
    setBusy(row.user_id + row.kind);
    try { await adminDecideAbn(row.user_id, row.kind, approve); await load(); onChange && onChange(); }
    catch (e) { setErr(e.message || String(e)); } finally { setBusy(null); }
  }

  if (rows == null) return <Loading />;
  return (
    <ScrollView contentContainerStyle={s.body}>
      {!!err && <Text style={s.err}>{err}</Text>}
      {rows.length === 0 ? <Empty label="No ABNs waiting for review." />
        : rows.map((r) => (
          <View key={r.user_id + r.kind} style={s.card}>
            <Text style={s.cardTitle}>{formatAbn(r.abn)}</Text>
            <Text style={s.cardSub}>{r.name || 'Unnamed'} · {r.kind}{r.status ? ` · ${r.status}` : ''}</Text>
            <View style={s.rowBtns}>
              <TouchableOpacity style={[s.okBtn, busy && { opacity: 0.5 }]} disabled={!!busy} onPress={() => decide(r, true)}>
                <Text style={s.okBtnT}>✓ Verify</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.noBtn, busy && { opacity: 0.5 }]} disabled={!!busy} onPress={() => decide(r, false)}>
                <Text style={s.noBtnT}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
    </ScrollView>
  );
}

// ── User lookup + grant/remove ────────────────────────────────────────────────
function Users() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);   // selected user for detail

  async function search() {
    setErr('');
    try { setRows(await adminSearchUsers(q)); } catch (e) { setErr(e.message || String(e)); setRows([]); }
  }
  useEffect(() => { search(); }, []); // initial: first 25

  if (sel) return <UserDetail user={sel} onBack={() => setSel(null)} />;
  return (
    <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
        <TextInput style={[s.input, { flex: 1 }]} value={q} onChangeText={setQ} placeholder="Search name / company" placeholderTextColor={C.mute2} onSubmitEditing={search} returnKeyType="search" />
        <TouchableOpacity style={s.searchBtn} onPress={search}><Text style={s.searchBtnT}>Search</Text></TouchableOpacity>
      </View>
      {!!err && <Text style={s.err}>{err}</Text>}
      {rows == null ? <Loading />
        : rows.length === 0 ? <Empty label="No users found." />
        : rows.map((u) => (
          <TouchableOpacity key={u.id} style={s.card} onPress={() => setSel(u)} activeOpacity={0.85}>
            <Text style={s.cardTitle}>{u.name || 'Unnamed'}</Text>
            <Text style={s.cardSub}>{u.account_type || '—'}{u.is_online ? ' · online' : ''}{u.rating ? ` · ★ ${Number(u.rating).toFixed(1)}` : ''}</Text>
            <Text style={s.cardMeta}>
              work: {u.can_work ? '✓' : '—'} ({u.worker_verify_status || 'none'}) · hire: {u.can_hire ? '✓' : '—'} ({u.company_verify_status || 'none'})
            </Text>
          </TouchableOpacity>
        ))}
    </ScrollView>
  );
}

function UserDetail({ user, onBack }) {
  const [creds, setCreds] = useState(null);
  const [vehicles, setVehicles] = useState(null);
  const [types, setTypes] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pickType, setPickType] = useState('');
  const [num, setNum] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const [c, t, v] = await Promise.all([adminUserCredentials(user.id), listCredentialTypes(), adminUserVehicles(user.id).catch(() => [])]);
      setCreds(c); setTypes(t); setVehicles(v);
    } catch (e) { setErr(e.message || String(e)); setCreds([]); }
  }, [user.id]);
  useEffect(() => { load(); }, [load]);

  async function grant() {
    if (!pickType) { setErr('Pick a credential to grant.'); return; }
    setBusy(true); setErr('');
    try { await adminGrantCredential(user.id, pickType, num || null, null); setAdding(false); setPickType(''); setNum(''); await load(); }
    catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }
  async function remove(rowId) {
    setBusy(true); setErr('');
    try { await adminRemoveCredential(rowId); await load(); }
    catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
      <TouchableOpacity onPress={onBack}><Text style={s.back}>‹ Back to results</Text></TouchableOpacity>
      <Text style={[s.cardTitle, { fontSize: 20, marginTop: 8 }]}>{user.name || 'Unnamed'}</Text>
      <Text style={s.cardSub}>{user.account_type || '—'} · work {user.can_work ? '✓' : '—'} · hire {user.can_hire ? '✓' : '—'}</Text>
      {user.abn ? <Text style={s.cardMeta}>ABN {formatAbn(user.abn)} ({user.abn_status || 'none'})</Text> : null}

      {!!err && <Text style={[s.err, { marginTop: 10 }]}>{err}</Text>}

      <Text style={s.sectionLabel}>Credentials</Text>
      {creds == null ? <Loading />
        : creds.length === 0 ? <Empty label="None held." />
        : creds.map((c) => (
          <View key={c.id} style={s.credRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.credName}>{c.cred_name || c.credential_id}</Text>
              <Text style={s.cardMeta}>{[c.number && `No. ${c.number}`, c.expires_at && `exp ${c.expires_at}`].filter(Boolean).join(' · ') || ' '}</Text>
            </View>
            <View style={[s.pill, { backgroundColor: (c.status === 'verified' ? C.green : C.amber) + '1A' }]}>
              <Text style={[s.pillT, { color: c.status === 'verified' ? C.green : C.amber }]}>{c.status}</Text>
            </View>
            <TouchableOpacity onPress={() => remove(c.id)} disabled={busy}><Text style={s.rm}>✕</Text></TouchableOpacity>
          </View>
        ))}

      {/* Vehicles — read-only: rego + insurance the admin can eyeball */}
      <Text style={s.sectionLabel}>Vehicles</Text>
      {vehicles == null ? <Loading />
        : vehicles.length === 0 ? <Empty label="None on file." />
        : vehicles.map((v) => (
          <View key={v.id} style={s.credRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.credName}>{v.type}{v.make_model ? ` · ${v.make_model}` : ''}{v.rego ? `  ·  ${v.rego}` : ''}</Text>
              <Text style={s.cardMeta}>
                {[v.rego_expires && `rego ${isoToDMY(v.rego_expires)}`, v.insurer && v.insurer, v.insurance_expires && `ins ${isoToDMY(v.insurance_expires)}`].filter(Boolean).join(' · ') || 'no rego / insurance dates'}
              </Text>
            </View>
          </View>
        ))}

      {adding ? (
        <View style={[s.card, { marginTop: 12 }]}>
          <Text style={s.sectionLabel}>Grant a verified credential</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
            {types.map((t) => (
              <TouchableOpacity key={t.id} style={[s.typeChip, pickType === t.id && s.typeChipOn]} onPress={() => setPickType(t.id)}>
                <Text style={[s.typeChipT, pickType === t.id && s.typeChipTOn]}>{t.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TextInput style={[s.input, { marginTop: 10 }]} value={num} onChangeText={setNum} placeholder="Number (optional)" placeholderTextColor={C.mute2} autoCapitalize="characters" />
          <View style={s.rowBtns}>
            <TouchableOpacity style={[s.okBtn, busy && { opacity: 0.5 }]} disabled={busy} onPress={grant}><Text style={s.okBtnT}>{busy ? '…' : 'Grant verified'}</Text></TouchableOpacity>
            <TouchableOpacity style={s.noBtn} onPress={() => { setAdding(false); setPickType(''); setNum(''); }}><Text style={s.noBtnT}>Cancel</Text></TouchableOpacity>
          </View>
        </View>
      ) : (
        <TouchableOpacity style={[s.searchBtn, { marginTop: 14, alignSelf: 'flex-start' }]} onPress={() => setAdding(true)}>
          <Text style={s.searchBtnT}>+ Grant credential</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

// ── Ops health (read-only) ────────────────────────────────────────────────────
function Ops() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { (async () => {
    try { setRows(await adminActiveJobs()); } catch (e) { setErr(e.message || String(e)); setRows([]); }
  })(); }, []);
  if (rows == null) return <Loading />;
  return (
    <ScrollView contentContainerStyle={s.body}>
      {!!err && <Text style={s.err}>{err}</Text>}
      {rows.length === 0 ? <Empty label="No active jobs." />
        : rows.map((r) => {
          const over = Number(r.filled) > Number(r.items);
          return (
            <View key={r.id} style={s.card}>
              <Text style={s.cardSub}>{r.status}</Text>
              <Text style={s.cardTitle} numberOfLines={1}>{r.address_text || 'No address'}</Text>
              <Text style={[s.cardMeta, over && { color: C.red, fontWeight: '700' }]}>
                {r.filled} filled / {r.items} spot{Number(r.items) === 1 ? '' : 's'}{over ? '  ⚠ OVER-FILLED' : ''}
              </Text>
            </View>
          );
        })}
    </ScrollView>
  );
}

// ── shared bits ───────────────────────────────────────────────────────────────
function Loading() { return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={C.indigo} /></View>; }
function Empty({ label }) { return <Text style={{ color: C.mute, textAlign: 'center', padding: 30 }}>{label}</Text>; }

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.canvas },
  head: { paddingHorizontal: S.xl, paddingTop: 48, paddingBottom: 8 },
  back: { color: C.indigo, fontWeight: '600', fontSize: 15, marginBottom: 8 },
  h1: { fontSize: 26, fontWeight: '800', letterSpacing: -0.5, color: C.ink },
  stats: { flexDirection: 'row', gap: 8, paddingHorizontal: S.xl, paddingBottom: 10 },
  stat: { flex: 1, backgroundColor: C.panel, borderRadius: R.md, paddingVertical: 10, alignItems: 'center', ...shadowSm },
  statN: { fontSize: 20, fontWeight: '800' },
  statL: { fontSize: 10, color: C.mute, marginTop: 2, fontWeight: '600' },
  segRow: { flexDirection: 'row', gap: 6, paddingHorizontal: S.xl, paddingBottom: 10 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: R.md, backgroundColor: C.panel, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  segOn: { backgroundColor: C.indigo, borderColor: C.indigo },
  segT: { fontSize: 12.5, fontWeight: '700', color: C.mute },
  segTOn: { color: '#fff' },
  body: { padding: S.xl, paddingTop: 4, paddingBottom: 40 },
  card: { backgroundColor: C.panel, borderRadius: R.lg, padding: 14, marginBottom: 12, ...shadowSm },
  cardTitle: { fontSize: 15.5, fontWeight: '800', color: C.ink },
  cardSub: { fontSize: 12.5, color: C.mute, marginTop: 2, fontWeight: '600' },
  cardMeta: { fontSize: 12, color: C.mute2, marginTop: 3, fontFamily: MONO },
  pill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 6, alignSelf: 'flex-start' },
  pillT: { fontSize: 10.5, fontWeight: '800', fontFamily: MONO },
  evidence: { width: '100%', height: 190, borderRadius: R.md, marginTop: 10 },
  ghostBtn: { borderWidth: 1.5, borderColor: C.line, borderRadius: R.md, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  ghostBtnT: { color: C.indigo, fontWeight: '700', fontSize: 13 },
  rowBtns: { flexDirection: 'row', gap: 8, marginTop: 12 },
  okBtn: { flex: 1, backgroundColor: C.green, borderRadius: R.md, paddingVertical: 11, alignItems: 'center' },
  okBtnT: { color: '#fff', fontWeight: '800', fontSize: 14 },
  noBtn: { flex: 1, borderWidth: 1.5, borderColor: C.line, borderRadius: R.md, paddingVertical: 11, alignItems: 'center' },
  noBtnT: { color: C.mute, fontWeight: '800', fontSize: 14 },
  input: { backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: C.ink },
  searchBtn: { backgroundColor: C.indigo, borderRadius: R.md, paddingHorizontal: 16, justifyContent: 'center' },
  searchBtnT: { color: '#fff', fontWeight: '700', fontSize: 14 },
  sectionLabel: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  credRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: R.md, paddingHorizontal: 12, paddingVertical: 11, marginBottom: 8 },
  credName: { fontSize: 14, fontWeight: '700', color: C.ink },
  rm: { color: C.mute2, fontSize: 16, paddingHorizontal: 4 },
  typeChip: { borderWidth: 1.5, borderColor: C.line, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  typeChipOn: { borderColor: C.indigo, backgroundColor: C.indigo + '12' },
  typeChipT: { fontSize: 12.5, fontWeight: '700', color: C.mute },
  typeChipTOn: { color: C.indigo },
  err: { color: C.red, fontSize: 13, marginBottom: 10 },
});
