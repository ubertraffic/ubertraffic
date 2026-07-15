// Motion.js — the app's shared motion layer. Purposeful, Uber-style animation:
// things move BECAUSE state changed, springy but quick, never decorative.
// One place for all reusable animated primitives so motion feels consistent.
import React, { useRef, useEffect, useState } from 'react';
import { Animated, Pressable, Easing } from 'react-native';
import { M } from './theme';

// ---------------------------------------------------------------------------
// Entrance — a view that springs in (fade + slight rise) when it mounts.
// Use for cards arriving in a list so new items feel like they *land*.
// ---------------------------------------------------------------------------
export function Entrance({ children, delay = 0, from = 10, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.spring(a, { toValue: 1, useNativeDriver: true, ...M.springSnappy }).start();
    }, delay);
    return () => clearTimeout(t);
  }, [a, delay]);
  return (
    <Animated.View
      style={[style, {
        opacity: a,
        transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) }],
      }]}
    >
      {children}
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// PressableScale — any tappable that gently scales down on touch (tactile feel).
// Drop-in replacement for TouchableOpacity where you want the Uber "press".
// ---------------------------------------------------------------------------
export function PressableScale({ children, onPress, style, disabled, scaleTo = M.pressScale, hitSlop }) {
  const s = useRef(new Animated.Value(1)).current;
  const to = (v, cfg) => Animated.spring(s, { toValue: v, useNativeDriver: true, ...cfg }).start();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onPressIn={() => to(scaleTo, M.springSnappy)}
      onPressOut={() => to(1, M.springSoft)}
      disabled={disabled}
      hitSlop={hitSlop}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// AnimatedBar — a progress/fill bar that eases to its target width on change.
// `pct` is 0..100. The fill animates whenever pct changes (spots filling).
// ---------------------------------------------------------------------------
export function AnimatedBar({ pct, color, trackStyle, fillStyle, height = 6 }) {
  const w = useRef(new Animated.Value(pct)).current;
  useEffect(() => {
    Animated.spring(w, { toValue: pct, useNativeDriver: false, ...M.springSoft }).start();
  }, [pct, w]);
  return (
    <Animated.View style={[{ height, borderRadius: height / 2, overflow: 'hidden' }, trackStyle]}>
      <Animated.View style={[{
        height, borderRadius: height / 2, backgroundColor: color,
        width: w.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
      }, fillStyle]} />
    </Animated.View>
  );
}

// ---------------------------------------------------------------------------
// CountUp — a number that rolls smoothly to its new value (easeOutCubic).
// For counts/money that change so the change is *felt*, not snapped.
// ---------------------------------------------------------------------------
export function useCountUp(value, dur = 550) {
  const [display, setDisplay] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current, end = value;
    if (start === end) return;
    const t0 = Date.now();
    const id = setInterval(() => {
      const p = Math.min(1, (Date.now() - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (p >= 1) { clearInterval(id); from.current = end; }
    }, 16);
    return () => clearInterval(id);
  }, [value, dur]);
  return display;
}

// ---------------------------------------------------------------------------
// CrossFade — swaps between content when `keyId` changes (e.g. a status pill
// changing label). Old fades out, new fades in — no hard cut.
// ---------------------------------------------------------------------------
export function CrossFade({ keyId, children, style, duration = M.fast }) {
  const a = useRef(new Animated.Value(1)).current;
  const [shown, setShown] = useState({ keyId, children });
  useEffect(() => {
    if (keyId === shown.keyId) { setShown({ keyId, children }); return; }
    Animated.timing(a, { toValue: 0, duration, easing: Easing.out(Easing.quad), useNativeDriver: true })
      .start(() => {
        setShown({ keyId, children });
        Animated.timing(a, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      });
  }, [keyId, children, a, duration, shown.keyId]);
  return <Animated.View style={[style, { opacity: a }]}>{shown.children}</Animated.View>;
}

// ---------------------------------------------------------------------------
// Pulse (attention) — a subtle one-shot scale bump when `trigger` changes.
// For a card that just updated (a new spot filled) to draw the eye briefly.
// ---------------------------------------------------------------------------
export function useAttentionBump(trigger) {
  const s = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    Animated.sequence([
      Animated.spring(s, { toValue: 1.03, useNativeDriver: true, ...M.springSnappy }),
      Animated.spring(s, { toValue: 1, useNativeDriver: true, ...M.springSoft }),
    ]).start();
  }, [trigger, s]);
  return s;
}
