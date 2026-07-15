// useRealtime.js — subscribe to live DB changes and fire a callback.
// Keeps realtime wiring in one place so screens stay clean.
import { useEffect, useRef } from 'react';
import { supabase } from './supabaseClient';

/**
 * Subscribe to changes on one or more tables. Whenever any of them change,
 * `onChange` runs (debounced a touch so a burst of rows = one refresh).
 *
 * tables: array of table names, e.g. ['requests','assignments','dispatches']
 */
export function useRealtime(tables, onChange) {
  const cbRef = useRef(onChange);
  cbRef.current = onChange;

  useEffect(() => {
    let timer = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cbRef.current && cbRef.current(), 250);
    };

    const channel = supabase.channel('sitecall-live-' + Math.random().toString(36).slice(2));
    tables.forEach((t) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, fire);
    });
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(',')]);
}
