// RunBrief.js — the shopping brief a worker sees the MOMENT they have an active run,
// and any time until it's done. What to buy · where to buy · spend cap · drop-off —
// plus "message the client before you buy", where it's actually useful (not at the end).
// Read-only; reuses run info already loaded on the assignment. Never touches money/checkout.
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { C, R, T, E } from './theme';

function Row({ k, v }) {
  return (
    <View style={{ flexDirection: 'row', marginBottom: 8 }}>
      <Text style={{ width: 84, fontSize: 11, fontWeight: '700', color: C.mute, textTransform: 'uppercase', letterSpacing: 0.4, paddingTop: 2 }}>{k}</Text>
      <Text style={{ flex: 1, fontSize: 14.5, color: C.ink, lineHeight: 20 }}>{v}</Text>
    </View>
  );
}

export default function RunBrief({ list, pickup, cap, drop, onMessage }) {
  return (
    <View style={box}>
      <Text style={[T.eyebrow, { marginBottom: 12 }]}>Your run</Text>
      {list ? <Row k="Buy" v={list} /> : null}
      {pickup ? <Row k="Where" v={pickup} /> : null}
      {cap > 0 ? <Row k="Spend cap" v={`Up to $${cap}`} /> : null}
      {drop ? <Row k="Drop at" v={drop} /> : null}
      {onMessage ? (
        <TouchableOpacity onPress={onMessage} activeOpacity={0.9} style={msgBtn}>
          <Text style={{ fontSize: 17 }}>{'💬'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 15 }}>Check before you buy</Text>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12.5, marginTop: 1 }}>Message the client to confirm what's wanted</Text>
          </View>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const box = { backgroundColor: C.panel, borderRadius: R.lg, padding: 16, marginBottom: 16, ...E.sm };
const msgBtn = { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.indigo, borderRadius: R.md, paddingVertical: 13, paddingHorizontal: 14, marginTop: 4 };
