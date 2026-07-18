// TabBar.js — the floating "island" navigation: a detached, dark, rounded pill that hovers over
// the content (Uber-style) and slides away on scroll-down, returning on scroll-up. It's absolutely
// positioned, so screens add bottom padding to let their last rows clear it. `translateY` is an
// Animated value (from App's diffClamp on scroll) that hides/shows it; `accent` colours the active
// tab for the current side (indigo=Hire, green=Work).
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { C } from './theme';
import Icon from './Icon';

export default function TabBar({ tabs, active, onChange, translateY, accent = C.indigo }) {
  return (
    <Animated.View
      style={[styles.island, translateY ? { transform: [{ translateY }] } : null]}
      pointerEvents="box-none"
    >
      <View style={styles.pill}>
        {tabs.map((t) => {
          const on = t.key === active;
          return (
            <TouchableOpacity key={t.key} style={styles.tab} onPress={() => onChange(t.key)} activeOpacity={0.7}>
              {on && <View style={[styles.dot, { backgroundColor: accent }]} />}
              <Icon name={t.icon} size={22} color={on ? '#fff' : 'rgba(255,255,255,0.46)'} strokeWidth={on ? 2.4 : 2} />
              <Text style={[styles.label, on && styles.labelOn]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  island: { position: 'absolute', left: 40, right: 40, bottom: 24 },
  pill: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    backgroundColor: 'rgba(19,19,25,0.94)', borderRadius: 22, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)', paddingVertical: 11, paddingHorizontal: 6,
    shadowColor: '#000', shadowOpacity: 0.42, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 14,
  },
  tab: { flex: 1, alignItems: 'center', gap: 4, position: 'relative' },
  label: { fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4, color: 'rgba(255,255,255,0.46)', textTransform: 'uppercase' },
  labelOn: { color: '#fff' },
  dot: { position: 'absolute', top: -9, width: 4, height: 4, borderRadius: 2 },
});
