import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

/**
 * Supabase Realtime 구독 훅.
 * 지정한 테이블에 변경 발생 시 onChange 콜백을 실행한다.
 *
 * @example
 * useRealtime('leads', () => refetch());
 * useRealtime('sales_demos', () => refetchDemos(), { event: 'UPDATE' });
 */
export function useRealtime(
  table: string,
  onChange: () => void,
  options?: { event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'; enabled?: boolean }
): void {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  const event = options?.event ?? '*';
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;

    const channel = supabase
      .channel(`admin-realtime-${table}-${event}`)
      .on(
        'postgres_changes',
        { event, schema: 'public', table },
        () => callbackRef.current()
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [table, event, enabled]);
}

/**
 * 여러 테이블을 동시에 구독하는 훅.
 *
 * @example
 * useMultiRealtime(['leads', 'emails', 'sales_demos'], () => refetchAll());
 */
export function useMultiRealtime(
  tables: string[],
  onChange: () => void,
  options?: { enabled?: boolean }
): void {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const callbackRef = useRef(onChange);
  callbackRef.current = onChange;

  const enabled = options?.enabled ?? true;
  const tablesKey = tables.join(',');

  useEffect(() => {
    if (!enabled || tables.length === 0) return;

    let channel = supabase.channel(`admin-multi-${tablesKey}`);

    for (const table of tables) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        () => callbackRef.current()
      );
    }

    channel.subscribe();
    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tablesKey, enabled]);
}
