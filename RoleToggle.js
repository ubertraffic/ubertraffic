// RoleToggle.js — the signature Hire↔Work switch. A sliding thumb springs between the two sides and
// the thumb RECOLOURS indigo (Hire) ⇄ green (Work) as it travels, with a haptic tick — so changing
// sides visibly repaints the accent. Locked sides show a lock and still route through onSelect (which
// opens the unlock gate). Sits on the dark top chrome.
import React, { useRef, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import { C } from './theme';
import { tap } from './components2';

export default function RoleToggle({ role, canHire, canWork, onSelect }) {
  const idx = role === 'client' ? 0 : 1;
  const anim = useRef(new Animated.Value(idx)).current;
  const [w, setW] = useState(0);

  useEffect(() => {
    Animated.spring(anim, { toValue: idx, useNativeDriver: false, damping: 18, stiffness: 240, mass: 0.9 }).start();
  }, [idx]);

  const half = w > 0 ? (w - 6) / 2 : 0;   // track has 3px padding each side
  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, half] });
  const thumbColor = anim.interpolate({ inputRange: [0, 1], outputRange: [C.indigo, C.green] });

  const pick = (r) => { if (r !== role) tap('light'); onSelect(r); };

  return (
    <View style={styles.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {half > 0 && (
        <Animated.View style={[styles.thumb, { width: half, transform: [{ translateX }], backgroundColor: thumbColor }]} pointerEvents="none" />
      )}
      <TouchableOpacity style={styles.seg} activeOpacity={0.8} onPress={() => pick('client')}>
        <Text style={[styles.label, idx === 0 && styles.labelOn]}>Hire{!canHire ? ' 🔒' : ''}</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.seg} activeOpacity={0.8} onPress={() => pick('operator')}>
        <Text style={[styles.label, idx === 1 && styles.labelOn]}>Work{!canWork ? ' 🔒' : ''}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.10)', borderRadius: 12, padding: 3, position: 'relative' },
  thumb: {
    position: 'absolute', top: 3, left: 3, bottom: 3, borderRadius: 9,
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  seg: { paddingVertical: 8, paddingHorizontal: 16, minWidth: 62, alignItems: 'center', zIndex: 1 },
  label: { color: 'rgba(255,255,255,0.55)', fontWeight: '800', fontSize: 13, letterSpacing: 0.2 },
  labelOn: { color: '#fff' },
});
