// PublicProfile.js — the canonical reputation profile. Trust made visible.
// Renders get_public_profile() honestly: verified badges only when real, ratings with their
// count, experienced-but-unrated handled gracefully, trades capped so a profile reads focused.
// This is the app's trust backbone — every "who is this person" tap-through lands here.

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, ActivityIndicator, Image, TextInput } from 'react-native';
import { C, R, shadowSm } from './theme';
import Icon from './Icon';
import { getPublicProfile, updateMyProfileBio, getReputationExtras } from './accountService';
import { workersWithSkill } from './communityService';

const TRADE_CAP = 6;   // show a focused set; a legit tradie has a handful, not fifty

function monthYear(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  } catch (_) { return null; }
}

export default function PublicProfile({ visible, userId, onClose, meId }) {
  // viewUserId lets you BROWSE from one profile into a peer's (via skill discovery) without
  // unmounting — `stack` is the back-trail so the header ‹ returns you the way you came.
  const [viewUserId, setViewUserId] = useState(userId);
  const [stack, setStack] = useState([]);
  const [p, setP] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState(false);
  const [showAllTrades, setShowAllTrades] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftHead, setDraftHead] = useState('');
  const [draftBio, setDraftBio] = useState('');
  const [saving, setSaving] = useState(false);
  // Skill discovery — tap a skill tag to see other verified workers who do it.
  const [disc, setDisc] = useState(null);          // { skill } while the sheet is open
  const [discList, setDiscList] = useState(null);  // null = loading, [] = none found
  const [rep, setRep] = useState(null);            // { rehire_count, tag_counts } reputation extras

  const isOwner = !!meId && meId === viewUserId;

  const load = React.useCallback(() => {
    if (!viewUserId) return;
    setLoading(true); setLoadErr(false); setP(null); setShowAllTrades(false); setEditing(false);
    let settled = false;
    // hard timeout — a profile must never hang on an endless spinner (some payloads are large /
    // the network can stall). If nothing comes back in 10s, show an honest error + retry.
    const timer = setTimeout(() => {
      if (!settled) { settled = true; setLoadErr(true); setLoading(false); }
    }, 10000);
    getPublicProfile(viewUserId)
      .then((d) => { if (!settled) { settled = true; clearTimeout(timer); setP(d || null); setLoading(false); } })
      .catch(() => { if (!settled) { settled = true; clearTimeout(timer); setLoadErr(true); setLoading(false); } });
  }, [viewUserId]);

  // Host pointed us at a (new) user, or the modal (re)opened — start a fresh browse session.
  useEffect(() => {
    if (!visible || !userId) return;
    setViewUserId(userId); setStack([]); setDisc(null); setDiscList(null);
  }, [visible, userId]);

  useEffect(() => {
    if (!visible || !viewUserId) return;
    load();
  }, [visible, viewUserId, load]);

  // Reputation extras (re-hire count + good-unit tag tallies) — fetched alongside the
  // profile and merged in. Best-effort: a miss just hides the block, never blocks the profile.
  useEffect(() => {
    if (!visible || !viewUserId) { setRep(null); return; }
    let alive = true; setRep(null);
    getReputationExtras(viewUserId).then((r) => { if (alive) setRep(r); }).catch(() => {});
    return () => { alive = false; };
  }, [visible, viewUserId]);

  function openSkill(skill) {
    setDisc({ skill }); setDiscList(null);
    workersWithSkill(skill, viewUserId).then((rows) => setDiscList(rows)).catch(() => setDiscList([]));
  }
  function navigateTo(id) {
    if (!id || id === viewUserId) return;
    setStack((s) => [...s, viewUserId]);
    setDisc(null); setDiscList(null);
    setViewUserId(id);
  }
  function goBack() {
    setStack((s) => {
      if (!s.length) return s;
      setViewUserId(s[s.length - 1]);
      return s.slice(0, -1);
    });
  }

  function startEdit() {
    setDraftHead(p?.headline || '');
    setDraftBio(p?.bio || '');
    setEditing(true);
  }
  async function saveEdit() {
    setSaving(true);
    try {
      await updateMyProfileBio(draftHead, draftBio);
      setP((prev) => ({ ...prev, headline: draftHead.trim() || null, bio: draftBio.trim() || null }));
      setEditing(false);
    } catch (_) {} finally { setSaving(false); }
  }

  const first = (p?.name || 'This user').split(' ')[0];
  const initial = (p?.name || '?').charAt(0).toUpperCase();
  const trades = p?.trades || [];
  const shownTrades = showAllTrades ? trades : trades.slice(0, TRADE_CAP);
  const creds = p?.verified_credentials || [];
  const since = monthYear(p?.member_since);
  // reputation extras — top "good unit" tags, most-vouched first (scannable badges)
  const tagCounts = rep?.tag_counts || {};
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const rehireCount = rep?.rehire_count || 0;
  const vouchCount = rep?.vouch_count || 0;
  const vouchers = rep?.vouchers || [];

  // honest reputation line: distinguishes "new" from "experienced but unrated"
  const hasRating = p?.rating != null && p?.rating_count > 0;
  // which faces to show — driven by REAL data, not a role flag (many users do both)
  const hasWorkerSide = (p?.jobs_done > 0) || (p?.trades?.length > 0) || (p?.verified_credentials?.length > 0) || hasRating;
  const hasClientSide = p?.jobs_posted > 0;
  const clientHasRating = p?.client_rating != null && p?.client_rating_count > 0;
  const hasCompletion = p?.completion_rate != null;
  // jobs_done is a stored counter that isn't reliably maintained (it can read 0 while the worker
  // clearly has ratings + resolved jobs). Trust the real figure: the higher of the counter and the
  // computed resolved-jobs count, so the number never contradicts the ratings/completion shown.
  const jobsDone = Math.max(Number(p?.jobs_done) || 0, Number(p?.resolved_jobs) || 0);

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <TouchableOpacity onPress={stack.length ? goBack : onClose} style={styles.close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.closeT}>{stack.length ? '‹' : '✕'}</Text>
          </TouchableOpacity>
          <Text style={styles.headerT}>Profile</Text>
          <View style={{ width: 30 }} />
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={C.indigo} size="large" /></View>
        ) : loadErr ? (
          <View style={styles.center}>
            <Text style={styles.muted}>Couldn't load this profile.</Text>
            <TouchableOpacity onPress={load} style={styles.retryBtn} activeOpacity={0.85}>
              <Text style={styles.retryBtnT}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : !p || !p.exists ? (
          <View style={styles.center}><Text style={styles.muted}>Profile unavailable.</Text></View>
        ) : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
            {/* identity */}
            <View style={styles.top}>
              {p.avatar_url ? (
                <Image source={{ uri: p.avatar_url }} style={styles.avatarImg} />
              ) : (
                <View style={styles.avatar}><Text style={styles.avatarT}>{initial}</Text></View>
              )}
              <Text style={styles.name}>{p.name || 'SiteCall user'}</Text>
              {p.headline ? <Text style={styles.headline}>{p.headline}</Text> : null}
              {p.company ? <Text style={styles.company}>{p.company}</Text> : null}
              {/* verify + role line */}
              <View style={styles.badgeRow}>
                {p.worker_verified && (
                  <View style={styles.verifyPill}><Icon name="verified" size={13} color={C.green} /><Text style={styles.verifyT}>Verified worker</Text></View>
                )}
                {p.company_verified && (
                  <View style={styles.verifyPill}><Icon name="verified" size={13} color={C.green} /><Text style={styles.verifyT}>Verified business</Text></View>
                )}
              </View>
              {since ? <Text style={styles.since}>On SiteCall since {since}</Text> : null}
              {isOwner && !editing ? (
                <TouchableOpacity style={styles.editBtn} onPress={startEdit} activeOpacity={0.8}>
                  <Text style={styles.editBtnT}>{p.headline || p.bio ? 'Edit profile' : 'Add a headline & bio'}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* owner edit panel */}
            {isOwner && editing ? (
              <View style={styles.editPanel}>
                <Text style={styles.editLabel}>Headline</Text>
                <TextInput style={styles.editInput} value={draftHead} onChangeText={setDraftHead}
                  placeholder="e.g. Traffic controller · 6 yrs on Sydney sites" placeholderTextColor={C.mute2}
                  maxLength={60} />
                <Text style={styles.editLabel}>About</Text>
                <TextInput style={[styles.editInput, styles.editInputMulti]} value={draftBio} onChangeText={setDraftBio}
                  placeholder="How you work, what you're good at…" placeholderTextColor={C.mute2}
                  multiline maxLength={300} />
                <View style={styles.editActions}>
                  <TouchableOpacity onPress={() => setEditing(false)} style={styles.editCancel} disabled={saving}><Text style={styles.editCancelT}>Cancel</Text></TouchableOpacity>
                  <TouchableOpacity onPress={saveEdit} style={[styles.editSave, saving && { opacity: 0.6 }]} disabled={saving}><Text style={styles.editSaveT}>{saving ? 'Saving…' : 'Save'}</Text></TouchableOpacity>
                </View>
              </View>
            ) : null}

            {/* bio */}
            {!editing && p.bio ? (
              <View style={styles.bioBox}><Text style={styles.bioT}>{p.bio}</Text></View>
            ) : null}

            {/* reputation stats (worker side) — honest about new / unrated */}
            {hasWorkerSide && (
            <View style={styles.stats}>
              <View style={styles.stat}>
                {hasRating ? (
                  <>
                    <View style={styles.statRow}><Icon name="star" size={16} color={C.amber} /><Text style={styles.statNum}>{Number(p.rating).toFixed(1)}</Text></View>
                    <Text style={styles.statLabel}>{p.rating_count} rating{p.rating_count === 1 ? '' : 's'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.statNumMuted}>—</Text>
                    <Text style={styles.statLabel}>No ratings yet</Text>
                  </>
                )}
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>{jobsDone}</Text>
                <Text style={styles.statLabel}>job{jobsDone === 1 ? '' : 's'} done</Text>
              </View>
              {p.vehicle ? (
                <>
                  <View style={styles.statDivider} />
                  <View style={styles.stat}>
                    <Text style={styles.statNumSm}>{p.vehicle}</Text>
                    <Text style={styles.statLabel}>vehicle</Text>
                  </View>
                </>
              ) : null}
            </View>
            )}

            {/* derived reliability — computed from real resolved-job history, threshold-gated */}
            {hasCompletion && (
              <View style={styles.reliaBox}>
                <View style={styles.reliaLeft}>
                  <Text style={styles.reliaNum}>{p.completion_rate}%</Text>
                  <Text style={styles.reliaLabel}>completion rate</Text>
                </View>
                <Text style={styles.reliaSub}>Finished {p.completion_rate}% of {p.resolved_jobs} resolved jobs</Text>
              </View>
            )}

            {/* reputation extras — re-hire signal, peer vouches + scannable "good unit" badges */}
            {(rehireCount > 0 || vouchCount > 0 || topTags.length > 0) && (
              <View style={styles.repBox}>
                {rehireCount > 0 && (
                  <View style={styles.repRehire}>
                    <Icon name="verified" size={16} color={C.green} />
                    <Text style={styles.repRehireT}>
                      <Text style={styles.repRehireNum}>{rehireCount}</Text> client{rehireCount === 1 ? '' : 's'} would have {first} back
                    </Text>
                  </View>
                )}
                {vouchCount > 0 && (
                  <View style={[styles.repRehire, rehireCount > 0 && { marginTop: 10 }]}>
                    <Icon name="crew" size={16} color={C.indigo} />
                    <Text style={styles.repRehireT}>
                      Vouched by <Text style={styles.repVouchNum}>{vouchCount}</Text> workmate{vouchCount === 1 ? '' : 's'}
                      {vouchers.length ? ` · ${vouchers.slice(0, 3).join(', ')}` : ''}
                    </Text>
                  </View>
                )}
                {topTags.length > 0 && (
                  <View style={styles.repTagWrap}>
                    {topTags.map(([tag, n]) => (
                      <View key={tag} style={styles.repTag}>
                        <Text style={styles.repTagT}>{tag}</Text>
                        <Text style={styles.repTagN}>{n}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* client-side reputation — jobs posted + rating from workers (honest: null today) */}
            {hasClientSide && (
              <View style={[styles.stats, hasWorkerSide && { marginTop: 12 }]}>
                <View style={styles.stat}>
                  <Text style={styles.statNum}>{p.jobs_posted}</Text>
                  <Text style={styles.statLabel}>job{p.jobs_posted === 1 ? '' : 's'} posted</Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  {clientHasRating ? (
                    <>
                      <View style={styles.statRow}><Icon name="star" size={16} color={C.amber} /><Text style={styles.statNum}>{Number(p.client_rating).toFixed(1)}</Text></View>
                      <Text style={styles.statLabel}>{p.client_rating_count} from workers</Text>
                    </>
                  ) : (
                    <>
                      <Text style={styles.statNumMuted}>—</Text>
                      <Text style={styles.statLabel}>as a client</Text>
                    </>
                  )}
                </View>
              </View>
            )}

            {/* new-to-SiteCall honest note */}
            {p.is_new && (
              <View style={styles.newNote}>
                <Text style={styles.newNoteT}>New to SiteCall — building their track record.</Text>
              </View>
            )}

            {/* verified credentials — the trust anchor, only real ones. Compact chips (not a long
                stacked list) so a worker with several tickets still reads as one tidy row. */}
            {creds.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Verified credentials</Text>
                <View style={styles.chipWrap}>
                  {creds.map((c, i) => (
                    <View key={`${c.id}-${i}`} style={styles.credChip}>
                      <Icon name="verified" size={13} color={C.green} />
                      <Text style={styles.credChipT}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* skills — the tappable social layer. A skill sits WITH the verified credentials
                above it (trust), and tapping one finds other verified workers who do it. */}
            {trades.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Skills</Text>
                <Text style={styles.sectionHint}>Tap a skill to see others who do it</Text>
                <View style={styles.chipWrap}>
                  {shownTrades.map((tname, i) => (
                    <TouchableOpacity key={`${tname}-${i}`} style={styles.chip} activeOpacity={0.8} onPress={() => openSkill(tname)}>
                      <Text style={styles.chipT}>{tname}</Text>
                      <Text style={styles.chipTap}> ›</Text>
                    </TouchableOpacity>
                  ))}
                  {trades.length > TRADE_CAP && !showAllTrades && (
                    <TouchableOpacity style={styles.chipMore} onPress={() => setShowAllTrades(true)} activeOpacity={0.8}>
                      <Text style={styles.chipMoreT}>+{trades.length - TRADE_CAP} more</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            )}
          </ScrollView>
        )}

        {/* skill discovery sheet — verified workers who share this skill */}
        <Modal visible={!!disc} animationType="slide" transparent onRequestClose={() => setDisc(null)}>
          <View style={styles.discBackdrop}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={() => setDisc(null)} />
            <View style={styles.discSheet}>
              <View style={styles.discHeader}>
                <Text style={styles.discTitle}>{disc?.skill}</Text>
                <TouchableOpacity onPress={() => setDisc(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={styles.closeT}>✕</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.discSub}>Verified workers who do this</Text>
              {discList == null ? (
                <View style={{ paddingVertical: 30 }}><ActivityIndicator color={C.indigo} /></View>
              ) : discList.length === 0 ? (
                <Text style={styles.discEmpty}>No one else listed yet.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
                  {discList.map((w) => (
                    <TouchableOpacity key={w.user_id} style={styles.discRow} activeOpacity={0.85} onPress={() => navigateTo(w.user_id)}>
                      <View style={styles.discAv}><Text style={styles.discAvT}>{(w.name || '?').charAt(0).toUpperCase()}</Text></View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.discName}>{w.name || 'SiteCall worker'}</Text>
                        {w.rating != null && w.rating_count > 0 ? (
                          <Text style={styles.discMeta}>★ {Number(w.rating).toFixed(1)} · {w.rating_count} rating{w.rating_count === 1 ? '' : 's'}</Text>
                        ) : (
                          <Text style={styles.discMeta}>New — no ratings yet</Text>
                        )}
                      </View>
                      <Text style={styles.discChev}>›</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.canvas, paddingTop: 56 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 8 },
  close: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  closeT: { fontSize: 20, color: C.mute, fontWeight: '600' },
  headerT: { fontSize: 15, fontWeight: '800', color: C.ink, letterSpacing: 0.2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: C.mute, fontSize: 15 },
  retryBtn: { marginTop: 16, backgroundColor: C.indigo, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 28 },
  retryBtnT: { color: '#fff', fontWeight: '700', fontSize: 14 },
  top: { alignItems: 'center', marginTop: 20, paddingHorizontal: 24 },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.indigo, alignItems: 'center', justifyContent: 'center', ...shadowSm },
  avatarImg: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.line },
  avatarT: { color: '#fff', fontSize: 34, fontWeight: '800' },
  name: { fontSize: 24, fontWeight: '900', color: C.ink, marginTop: 14, letterSpacing: -0.5 },
  headline: { fontSize: 15, color: C.ink, fontWeight: '700', marginTop: 6, textAlign: 'center', paddingHorizontal: 20 },
  company: { fontSize: 15, color: C.mute, fontWeight: '600', marginTop: 3 },
  editBtn: { marginTop: 16, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 9 },
  editBtnT: { fontSize: 13.5, fontWeight: '800', color: C.indigo },
  editPanel: { marginHorizontal: 20, marginTop: 8, backgroundColor: C.panel, borderRadius: R.xl, padding: 16, ...shadowSm },
  editLabel: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 7, marginTop: 6 },
  editInput: { backgroundColor: C.canvas, borderRadius: R.md, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, color: C.ink },
  editInputMulti: { minHeight: 90, textAlignVertical: 'top' },
  editActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  editCancel: { paddingHorizontal: 16, paddingVertical: 10 },
  editCancelT: { fontSize: 14, fontWeight: '700', color: C.mute },
  editSave: { backgroundColor: C.indigo, borderRadius: R.md, paddingHorizontal: 20, paddingVertical: 10 },
  editSaveT: { fontSize: 14, fontWeight: '800', color: '#fff' },
  bioBox: { marginHorizontal: 20, marginTop: 20, backgroundColor: C.panel, borderRadius: R.xl, padding: 16, ...shadowSm },
  bioT: { fontSize: 14.5, color: C.ink, lineHeight: 21, fontWeight: '500' },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' },
  verifyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(14,122,82,0.10)', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  verifyT: { color: C.green, fontSize: 12.5, fontWeight: '800' },
  since: { fontSize: 13, color: C.mute2, fontWeight: '600', marginTop: 12 },
  stats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.panel, marginHorizontal: 20, marginTop: 18, paddingVertical: 18, borderRadius: R.xl, ...shadowSm },
  stat: { flex: 1, alignItems: 'center' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statNum: { fontSize: 22, fontWeight: '900', color: C.ink },
  statNumSm: { fontSize: 15, fontWeight: '800', color: C.ink, textTransform: 'capitalize' },
  statNumMuted: { fontSize: 22, fontWeight: '900', color: C.line },
  statLabel: { fontSize: 12, color: C.mute, fontWeight: '600', marginTop: 3, textAlign: 'center' },
  statDivider: { width: 1, height: 34, backgroundColor: C.line },
  reliaBox: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.panel, marginHorizontal: 20, marginTop: 12, padding: 16, borderRadius: R.xl, ...shadowSm },
  reliaLeft: { alignItems: 'center' },
  reliaNum: { fontSize: 24, fontWeight: '900', color: C.green, letterSpacing: -0.5 },
  reliaLabel: { fontSize: 11, color: C.mute, fontWeight: '700', marginTop: 2 },
  reliaSub: { flex: 1, fontSize: 13, color: C.mute, fontWeight: '600', lineHeight: 18 },
  repBox: { marginHorizontal: 20, marginTop: 12, backgroundColor: C.panel, borderRadius: R.xl, padding: 16, ...shadowSm },
  repRehire: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repRehireT: { fontSize: 14, color: C.ink, fontWeight: '600', flex: 1 },
  repRehireNum: { fontWeight: '900', color: C.green },
  repVouchNum: { fontWeight: '900', color: C.indigo },
  repTagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  repTag: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(16,163,90,0.10)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  repTagT: { fontSize: 12.5, fontWeight: '700', color: C.green },
  repTagN: { fontSize: 11.5, fontWeight: '800', color: C.green, opacity: 0.7 },
  newNote: { marginHorizontal: 20, marginTop: 14, backgroundColor: 'rgba(70,54,232,0.06)', borderRadius: R.lg, paddingVertical: 12, paddingHorizontal: 14 },
  newNoteT: { fontSize: 13.5, color: C.indigo, fontWeight: '700', textAlign: 'center' },
  section: { marginHorizontal: 20, marginTop: 20 },
  sectionLabel: { fontSize: 12, fontWeight: '800', color: C.mute, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 12 },
  sectionHint: { fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: -6, marginBottom: 12 },
  credRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.panel, borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, ...shadowSm },
  credT: { fontSize: 14.5, fontWeight: '700', color: C.ink },
  credChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(14,122,82,0.10)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  credChipT: { fontSize: 13, fontWeight: '800', color: C.green },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8, ...shadowSm },
  chipT: { fontSize: 13, fontWeight: '700', color: C.ink },
  chipTap: { fontSize: 13, fontWeight: '800', color: C.indigo },
  chipMore: { backgroundColor: 'rgba(70,54,232,0.08)', borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  chipMoreT: { fontSize: 13, fontWeight: '800', color: C.indigo },
  discBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  discSheet: { backgroundColor: C.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 34 },
  discHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  discTitle: { fontSize: 18, fontWeight: '900', color: C.ink, letterSpacing: -0.3, flex: 1 },
  discSub: { fontSize: 13, color: C.mute, fontWeight: '600', marginTop: 2, marginBottom: 14 },
  discEmpty: { fontSize: 14, color: C.mute, fontWeight: '600', paddingVertical: 24, textAlign: 'center' },
  discRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: R.md, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 8, ...shadowSm },
  discAv: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.indigo, alignItems: 'center', justifyContent: 'center' },
  discAvT: { color: '#fff', fontSize: 17, fontWeight: '800' },
  discName: { fontSize: 15, fontWeight: '800', color: C.ink },
  discMeta: { fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 2 },
  discChev: { fontSize: 22, color: C.mute2, fontWeight: '300' },
});
