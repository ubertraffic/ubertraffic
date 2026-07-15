// TabBar.js — the always-there bottom navigation spine.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { C, MONO, shadowSm } from './theme';
import Icon from './Icon';

export default function TabBar({ tabs, active, onChange }) {
  return (
    <View style={styles.bar}>
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <TouchableOpacity key={t.key} style={styles.tab} onPress={() => onChange(t.key)} activeOpacity={0.7}>
            {on && <View style={styles.dot} />}
            <Icon name={t.icon} size={22} color={on ? C.indigo : C.mute2} strokeWidth={on ? 2.4 : 2} />
            <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line,
    paddingTop: 10, paddingBottom: 28, paddingHorizontal: 6, ...shadowSm,
  },
  tab: { flex: 1, alignItems: 'center', gap: 5, position: 'relative' },
  label: { fontFamily: MONO, fontSize: 9, fontWeight: '600', letterSpacing: 0.5, color: C.mute2, textTransform: 'uppercase' },
  labelOn: { color: C.indigo },
  dot: { position: 'absolute', top: -10, width: 4, height: 4, borderRadius: 2, backgroundColor: C.indigo },
});
