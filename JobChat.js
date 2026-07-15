// JobChat.js — the job room's chat sheet. Rises over the current screen
// (no navigation away — Uber-style contextual messaging). Durable messages,
// realtime delivery, honest read marks, system opening line.
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Modal, TouchableOpacity, TextInput, ScrollView,
  KeyboardAvoidingView, Platform, ActivityIndicator, StyleSheet,
} from 'react-native';
import { C, S, R, T, E } from './theme';
import { listRoomMessages, sendRoomMessage, markRoomRead, subscribeToRoom } from './messagesService';

function timeShort(iso) {
  return new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
}

/**
 * props:
 *   visible      — show/hide
 *   onClose      — dismiss
 *   assignmentId — the room
 *   meId         — my user id (which side bubbles align)
 *   title        — header line, e.g. "Marcus · Yard hand" or "Job room"
 *   subtitle     — e.g. "The Ponds · on the way"
 */
export default function JobChat({ visible, onClose, assignmentId, meId, title, subtitle, jobInfo, peerId, onOpenProfile }) {
  const [msgs, setMsgs] = useState(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const scrollRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const m = await listRoomMessages(assignmentId);
      setMsgs(m);
      markRoomRead(assignmentId).catch(() => {});
    } catch (e) { setErr('Could not load messages.'); }
  }, [assignmentId]);

  useEffect(() => {
    if (!visible || !assignmentId) return;
    setMsgs(null); setErr('');
    load();
    // realtime: new messages arrive instantly; mark read since the room is open
    const unsub = subscribeToRoom(assignmentId, (m) => {
      setMsgs((prev) => {
        if (!prev) return [m];
        if (prev.some((x) => x.id === m.id)) return prev;   // de-dupe vs. own send
        return [...prev, m];
      });
      if (m.sender_id !== meId) markRoomRead(assignmentId).catch(() => {});
    });
    // gentle poll as realtime fallback
    const t = setInterval(load, 8000);
    return () => { unsub(); clearInterval(t); };
  }, [visible, assignmentId, load, meId]);

  useEffect(() => {
    // keep pinned to the latest message
    if (msgs && scrollRef.current) setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
  }, [msgs]);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setErr('');
    try {
      const m = await sendRoomMessage(assignmentId, body);
      setDraft('');
      setMsgs((prev) => {
        if (!prev) return [m];
        if (prev.some((x) => x.id === m.id)) return prev;
        return [...prev, m];
      });
    } catch (e) {
      setErr((e?.message || 'Send failed').replace(/^.*?:\s*/, ''));
    } finally { setSending(false); }
  }

  // read receipt: the last of MY messages that the other side has read
  const lastReadMineId = (() => {
    if (!msgs) return null;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.sender_id === meId && m.read_at) return m.id;
    }
    return null;
  })();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={st.scrim}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <View style={st.sheet}>
            {/* header */}
            <View style={st.head}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => { if (peerId && onOpenProfile) onOpenProfile(peerId); }}
                disabled={!peerId || !onOpenProfile}
                activeOpacity={peerId && onOpenProfile ? 0.6 : 1}
              >
                <Text style={st.title} numberOfLines={1}>{title || 'Job room'}{peerId && onOpenProfile ? '  ›' : ''}</Text>
                {!!subtitle && <Text style={st.sub} numberOfLines={1}>{subtitle}</Text>}
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={st.close}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* job-info header — handy context for both parties */}
            {jobInfo && (
              <View style={st.infoCard}>
                {jobInfo.map((row, i) => (
                  <View key={i} style={st.infoRow}>
                    <Text style={st.infoLabel}>{row.label}</Text>
                    <Text style={st.infoVal} numberOfLines={1}>{row.value}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* messages */}
            <ScrollView
              ref={scrollRef}
              style={st.scroll}
              contentContainerStyle={{ paddingVertical: 14, paddingHorizontal: 16 }}
              keyboardShouldPersistTaps="handled"
            >
              {/* system opening line — the room's welcome, always present */}
              <View style={st.sysWrap}>
                <Text style={st.sysT}>You're connected. Messages here are private to this job and visible to both of you.</Text>
              </View>

              {msgs === null ? <ActivityIndicator color={C.indigo} style={{ marginTop: 20 }} />
                : msgs.length === 0 ? (
                  <Text style={st.emptyT}>Say g'day — access notes, gate codes, parking, anything that helps the job go smoothly.</Text>
                ) : msgs.map((m) => {
                  const mine = m.sender_id === meId;
                  return (
                    <View key={m.id} style={[st.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
                      <View style={[st.bubble, mine ? st.bubbleMine : st.bubbleTheirs]}>
                        <Text style={[st.bubbleT, mine && { color: '#fff' }]}>{m.body}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-end' }}>
                          <Text style={[st.bubbleTime, mine && { color: 'rgba(255,255,255,0.65)' }]}>{timeShort(m.created_at)}</Text>
                          {mine && m.id === lastReadMineId && <Text style={st.readT}>· Seen</Text>}
                        </View>
                      </View>
                    </View>
                  );
                })}
            </ScrollView>

            {/* composer */}
            {!!err && <Text style={st.err}>{err}</Text>}
            <View style={st.composer}>
              <TextInput
                style={st.input}
                placeholder="Message…"
                placeholderTextColor={C.mute2}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={1000}
              />
              <TouchableOpacity
                style={[st.sendBtn, (!draft.trim() || sending) && { opacity: 0.4 }]}
                onPress={send}
                disabled={!draft.trim() || sending}
                activeOpacity={0.85}
              >
                <Text style={st.sendT}>{sending ? '…' : '↑'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const st = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: C.scrim },
  sheet: {
    backgroundColor: C.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    height: '78%', overflow: 'hidden', ...E.lg,
  },
  head: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 14,
    backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line2,
  },
  title: { fontSize: 17, fontWeight: '800', color: C.ink, letterSpacing: -0.3 },
  infoCard: { marginHorizontal: 16, marginTop: 4, marginBottom: 4, backgroundColor: C.panel2 || '#F4F5F7', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  infoLabel: { fontSize: 12, color: C.mute2 || '#8A8A94', fontWeight: '600' },
  infoVal: { fontSize: 13, color: C.ink, fontWeight: '700', flexShrink: 1, marginLeft: 12, textAlign: 'right' },
  sub: { fontSize: 12.5, color: C.mute, marginTop: 2 },
  close: { fontSize: 17, color: C.mute, fontWeight: '600', padding: 2 },
  scroll: { flex: 1 },
  sysWrap: { alignItems: 'center', marginBottom: 12 },
  sysT: {
    fontSize: 11.5, color: C.mute, textAlign: 'center', lineHeight: 16,
    backgroundColor: C.panel2, paddingVertical: 7, paddingHorizontal: 14, borderRadius: 999, overflow: 'hidden', maxWidth: 300,
  },
  emptyT: { fontSize: 13, color: C.mute, textAlign: 'center', marginTop: 18, lineHeight: 19, paddingHorizontal: 20 },
  bubbleRow: { flexDirection: 'row', marginBottom: 8 },
  bubble: { maxWidth: '80%', borderRadius: 18, paddingVertical: 9, paddingHorizontal: 13 },
  bubbleMine: { backgroundColor: C.indigo, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: C.panel, borderBottomLeftRadius: 6, ...E.sm },
  bubbleT: { fontSize: 14.5, color: C.ink, lineHeight: 20 },
  bubbleTime: { fontSize: 10, color: C.mute2, marginTop: 3 },
  readT: { fontSize: 10, color: 'rgba(255,255,255,0.65)', marginTop: 3 },
  err: { color: C.red, fontSize: 12, textAlign: 'center', paddingVertical: 4 },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: Platform.OS === 'ios' ? 26 : 14,
    backgroundColor: C.panel, borderTopWidth: 1, borderTopColor: C.line2,
  },
  input: {
    flex: 1, minHeight: 42, maxHeight: 110, backgroundColor: C.panel2,
    borderRadius: 21, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11,
    fontSize: 14.5, color: C.ink,
  },
  sendBtn: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: C.indigo,
    alignItems: 'center', justifyContent: 'center',
  },
  sendT: { color: '#fff', fontSize: 19, fontWeight: '800' },
});
