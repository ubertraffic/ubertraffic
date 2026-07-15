// messagesService.js — the job room's conversation layer.
// Durable messages via validated RPCs; reads via RLS-guarded select.
import { supabase } from './supabaseClient';

/** All messages in one job room (assignment), oldest first. */
export async function listRoomMessages(assignmentId) {
  const { data, error } = await supabase
    .from('job_messages')
    .select('id, assignment_id, sender_id, body, created_at, read_at')
    .eq('assignment_id', assignmentId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return data || [];
}

/** Send a message into the room. Server validates participant, length, rate. */
export async function sendRoomMessage(assignmentId, body) {
  const { data, error } = await supabase.rpc('send_job_message', { aid: assignmentId, msg: body });
  if (error) throw error;
  return data;
}

/** Mark everything the other side sent as read. */
export async function markRoomRead(assignmentId) {
  const { error } = await supabase.rpc('mark_room_read', { aid: assignmentId });
  if (error) throw error;
}

/** Unread counts for my rooms: { assignmentId: n }. RLS scopes to my rooms. */
export async function getUnreadCounts(myUserId) {
  const { data, error } = await supabase
    .from('job_messages')
    .select('id, assignment_id, sender_id, read_at')
    .is('read_at', null)
    .neq('sender_id', myUserId)
    .limit(500);
  if (error) throw error;
  const counts = {};
  (data || []).forEach((m) => { counts[m.assignment_id] = (counts[m.assignment_id] || 0) + 1; });
  return counts;
}

/** Subscribe to new messages in one room. Returns unsubscribe fn. */
export function subscribeToRoom(assignmentId, onMessage) {
  const ch = supabase
    .channel(`room-${assignmentId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'job_messages', filter: `assignment_id=eq.${assignmentId}` },
      (payload) => onMessage(payload.new))
    .subscribe();
  return () => { supabase.removeChannel(ch); };
}
