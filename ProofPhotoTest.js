// ProofPhotoTest.js — THROWAWAY smoke-test screen for the photo pipe.
//
// Not part of the app. Mount it temporarily (e.g. render <ProofPhotoTest/> at the
// top of App instead of the normal shell) to prove: camera -> GPS -> upload ->
// Storage -> job_events row, all end to end, with one real assignment. Delete once
// the pipe is confirmed.

import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { supabase } from './supabaseClient';
import { C, S, R, T } from './theme';
import ProofPhoto from './ProofPhoto';

export default function ProofPhotoTest() {
  const [assignmentId, setAssignmentId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState([]);
  const [err, setErr] = useState('');

  // Grab any assignment belonging to the signed-in operator to test against.
  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u?.user) { setErr('Sign in first, then reload.'); setLoading(false); return; }
        const { data, error } = await supabase
          .from('assignments')
          .select('id, status, operator_id')
          .eq('operator_id', u.user.id)
          .order('accepted_at', { ascending: false })
          .limit(1);
        if (error) throw error;
        if (!data || !data[0]) { setErr('No assignments found for this account. Accept a job first.'); setLoading(false); return; }
        setAssignmentId(data[0].id);
        setLoading(false);
      } catch (e) {
        setErr((e && e.message) || 'Failed to load an assignment.');
        setLoading(false);
      }
    })();
  }, []);

  // After a capture, read back the job_events to PROVE the row landed.
  async function refreshEvents() {
    if (!assignmentId) return;
    try {
      const { data, error } = await supabase
        .from('job_events')
        .select('kind, context, lat, lng, created_at')
        .eq('assignment_id', assignmentId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      setEvents(data || []);
    } catch (e) {
      setErr((e && e.message) || 'Failed to read events.');
    }
  }

  useEffect(() => { if (assignmentId) refreshEvents(); }, [assignmentId]);

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.canvas }}><ActivityIndicator color={C.indigo} /></View>;
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.canvas }} contentContainerStyle={{ padding: S.xl, paddingTop: 60 }}>
      <Text style={[T.eyebrow, { marginBottom: S.sm }]}>Photo pipe smoke test</Text>
      {err ? <Text style={[T.body, { color: C.red, marginBottom: S.md }]}>{err}</Text> : null}

      {assignmentId ? (
        <>
          <Text style={[T.small, { color: C.mute, marginBottom: S.lg }]}>
            Testing against assignment {assignmentId.slice(0, 8)}…
          </Text>

          <ProofPhoto
            assignmentId={assignmentId}
            kind="completion"
            label="Test proof photo"
            onCaptured={() => setTimeout(refreshEvents, 800)}
          />

          <Text style={[T.body, { fontWeight: '700', marginTop: S.xl, marginBottom: S.sm }]}>
            job_events for this assignment:
          </Text>
          {events.length === 0 ? (
            <Text style={[T.small, { color: C.mute }]}>None yet — take a photo above, then it should appear here.</Text>
          ) : (
            events.map((e, i) => (
              <View key={i} style={{ backgroundColor: '#fff', borderRadius: R.sm, padding: S.md, marginBottom: S.sm }}>
                <Text style={[T.small, { fontWeight: '700' }]}>{e.kind}{e.context?.photo_kind ? ` · ${e.context.photo_kind}` : ''}</Text>
                <Text style={[T.small, { color: C.mute }]}>
                  {e.lat != null ? `${e.lat.toFixed(4)}, ${e.lng.toFixed(4)} · ` : 'no GPS · '}
                  {new Date(e.created_at).toLocaleTimeString()}
                </Text>
                {e.context?.photo_url ? <Text style={[T.small, { color: C.mute }]} numberOfLines={1}>{e.context.photo_url}</Text> : null}
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}
