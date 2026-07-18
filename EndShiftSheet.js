// EndShiftSheet.js — the calm bookend to going online. Tapping the online pill opens this: a
// "Nice work" summary of the shift (earnings / jobs / time online) followed by a deliberate
// SLIDE-to-go-offline (Instacart's model) so a stray tap never ends a shift. Going online is a
// joyful commitment; going offline is a considered, rewarding close.
import React, { useRef, useState, useEffect } from 'react';
import { Modal, View, Text, TouchableOpacity, Animated, PanResponder, StyleSheet, Dimensions, Easing } from 'react-native';
import { C } from './theme';
import { tap } from './components2';

const { width: SCREEN_W } = Dimensions.get('window');

// A drag-the-thumb-to-confirm track. One clear thumb at the far left; the label stays PUT and just
// fades as you drag (research: static label + one recognizable handle). Native-driven so it's smooth.
// onComplete fires once the thumb passes ~70%; releases short spring back.
function SlideToConfirm({ label, onComplete }) {
  const [w, setW] = useState(SCREEN_W - 96);
  const THUMB = 54;
  const PAD = 5;
  const x = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  const max = Math.max(1, w - THUMB - PAD * 2);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 2,
      onPanResponderMove: (_e, g) => { x.setValue(Math.min(Math.max(0, g.dx), max)); },
      onPanResponderRelease: (_e, g) => {
        const nx = Math.min(Math.max(0, g.dx), max);
        if (nx >= max * 0.7 && !done.current) {
          done.current = true;
          tap('success');
          Animated.timing(x, { toValue: max, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true })
            .start(() => onComplete && onComplete());
        } else {
          Animated.spring(x, { toValue: 0, useNativeDriver: true, damping: 16, stiffness: 220 }).start();
        }
      },
    })
  ).current;

  const labelOpacity = x.interpolate({ inputRange: [0, max * 0.5], outputRange: [1, 0], extrapolate: 'clamp' });

  return (
    <View style={styles.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Animated.Text style={[styles.trackLabel, { opacity: labelOpacity }]} pointerEvents="none">{label}</Animated.Text>
      <Animated.View style={[styles.thumb, { transform: [{ translateX: x }] }]} {...pan.panHandlers}>
        <Text style={styles.thumbArrow}>›</Text>
      </Animated.View>
    </View>
  );
}

export default function EndShiftSheet({ visible, onClose, onConfirmOffline, summary }) {
  const y = useRef(new Animated.Value(600)).current;
  const dim = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (visible) {
      setShown(true);
      Animated.parallel([
        Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }),
        Animated.timing(dim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else if (shown) {
      Animated.parallel([
        Animated.timing(y, { toValue: 600, duration: 220, useNativeDriver: true }),
        Animated.timing(dim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start(() => setShown(false));
    }
  }, [visible]);

  const s = summary || {};
  const hrs = Math.floor((s.minutes || 0) / 60);
  const mins = (s.minutes || 0) % 60;
  const timeStr = hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;

  return (
    <Modal visible={shown} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Animated.View style={[styles.host, { opacity: dim }]}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY: y }] }]}>
          <View style={styles.grab} />
          <Text style={styles.title}>Nice work today</Text>
          <Text style={styles.sub}>Here's your shift so far.</Text>
          <View style={styles.statRow}>
            <View style={styles.stat}>
              <Text style={styles.statNum}>${s.today || 0}</Text>
              <Text style={styles.statLabel}>Earned</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{s.jobs || 0}</Text>
              <Text style={styles.statLabel}>{(s.jobs || 0) === 1 ? 'Job' : 'Jobs'}</Text>
            </View>
            <View style={styles.stat}>
              <Text style={styles.statNum}>{timeStr}</Text>
              <Text style={styles.statLabel}>Online</Text>
            </View>
          </View>
          {s.pending > 0 && (
            <View style={styles.pendingNote}>
              <Text style={styles.pendingT}>{s.pending} job{s.pending > 1 ? 's' : ''} awaiting approval — your pay lands once the client approves.</Text>
            </View>
          )}
          <SlideToConfirm label="Slide to go offline" onComplete={() => { onConfirmOffline && onConfirmOffline(); onClose && onClose(); }} />
          <TouchableOpacity onPress={onClose} style={styles.stay} activeOpacity={0.8}>
            <Text style={styles.stayT}>Stay online</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.canvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 40 },
  grab: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: C.line, marginBottom: 18 },
  title: { fontSize: 24, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  sub: { fontSize: 14, color: C.mute, fontWeight: '600', marginTop: 4, marginBottom: 22 },
  statRow: { flexDirection: 'row', gap: 12, marginBottom: 26 },
  stat: { flex: 1, backgroundColor: C.panel, borderRadius: 18, paddingVertical: 18, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  statNum: { fontSize: 22, fontWeight: '900', color: C.ink, letterSpacing: -0.5 },
  statLabel: { fontSize: 11.5, fontWeight: '700', color: C.mute, letterSpacing: 0.3, textTransform: 'uppercase', marginTop: 5 },
  track: { height: 64, borderRadius: 18, backgroundColor: '#191921', justifyContent: 'center' },
  trackLabel: { textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontSize: 14.5, fontWeight: '800', letterSpacing: 0.4 },
  thumb: {
    position: 'absolute', left: 5, top: 5, width: 54, height: 54, borderRadius: 14, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
  },
  thumbArrow: { color: C.ink, fontSize: 27, fontWeight: '900', marginTop: -2 },
  pendingNote: { backgroundColor: 'rgba(214,158,46,0.12)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, marginBottom: 16 },
  pendingT: { color: C.amber, fontSize: 12.5, fontWeight: '700', lineHeight: 18 },
  stay: { alignItems: 'center', paddingVertical: 14, marginTop: 6 },
  stayT: { color: C.mute, fontSize: 14, fontWeight: '700' },
});
