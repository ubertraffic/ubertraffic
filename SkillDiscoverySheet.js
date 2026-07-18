// SkillDiscoverySheet.js — tap a skill anywhere, see other verified workers who do it.
// The social layer, made reachable from the home screen (not only buried in the public profile).
// Reads workersWithSkill(). Self-contained bottom sheet. Props:
//   skill (string | null — null hides it) · excludeUserId · onClose() · onOpenProfile(userId)
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet } from 'react-native';
import { C, R, shadowSm } from './theme';
import { workersWithSkill } from './communityService';

export default function SkillDiscoverySheet({ skill, excludeUserId, onClose, onOpenProfile }) {
  const [list, setList] = useState(null);   // null = loading, [] = none

  useEffect(() => {
    if (!skill) { setList(null); return; }
    let alive = true;
    setList(null);
    workersWithSkill(skill, excludeUserId).then((rows) => { if (alive) setList(rows || []); }).catch(() => { if (alive) setList([]); });
    return () => { alive = false; };
  }, [skill, excludeUserId]);

  return (
    <Modal visible={!!skill} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={s.sheet}>
          <View style={s.grip} />
          <View style={s.head}>
            <Text style={s.title}>{skill}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}><Text style={s.close}>✕</Text></TouchableOpacity>
          </View>
          <Text style={s.sub}>Verified workers who do this</Text>
          {/* Reserve a stable height so the sheet doesn't jump taller when the list loads in after
              the slide-up — that resize was the "glitch". Loading, empty, and short lists now open
              at the same size. */}
          <View style={{ minHeight: 220 }}>
          {list == null ? (
            <View style={{ paddingVertical: 40 }}><ActivityIndicator color={C.indigo} /></View>
          ) : list.length === 0 ? (
            <Text style={s.empty}>No one else listed yet — you could be the first they see.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {list.map((w) => (
                <TouchableOpacity key={w.user_id} style={s.row} activeOpacity={0.85} onPress={() => { onOpenProfile && onOpenProfile(w.user_id); onClose && onClose(); }}>
                  <View style={s.av}><Text style={s.avT}>{(w.name || '?').charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name}>{w.name || 'SiteCall worker'}</Text>
                    {w.rating != null && w.rating_count > 0
                      ? <Text style={s.meta}>★ {Number(w.rating).toFixed(1)} · {w.rating_count} rating{w.rating_count === 1 ? '' : 's'}</Text>
                      : <Text style={s.meta}>New — no ratings yet</Text>}
                  </View>
                  <Text style={s.chev}>›</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { backgroundColor: C.canvas, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 20, paddingTop: 10, paddingBottom: 34 },
  grip: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, alignSelf: 'center', marginBottom: 12 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 19, fontWeight: '900', color: C.ink, letterSpacing: -0.3, flex: 1 },
  close: { fontSize: 20, color: C.mute, fontWeight: '600' },
  sub: { fontSize: 13, color: C.mute, fontWeight: '600', marginTop: 2, marginBottom: 14 },
  empty: { fontSize: 14, color: C.mute, fontWeight: '600', paddingVertical: 24, textAlign: 'center', lineHeight: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.panel, borderRadius: R.md, paddingVertical: 11, paddingHorizontal: 13, marginBottom: 8, ...shadowSm },
  av: { width: 40, height: 40, borderRadius: 20, backgroundColor: C.indigo, alignItems: 'center', justifyContent: 'center' },
  avT: { color: '#fff', fontSize: 17, fontWeight: '800' },
  name: { fontSize: 15, fontWeight: '800', color: C.ink },
  meta: { fontSize: 12.5, color: C.mute, fontWeight: '600', marginTop: 2 },
  chev: { fontSize: 22, color: C.mute2, fontWeight: '300' },
});
