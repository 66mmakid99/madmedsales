// v1.0 - 2026-03-16
// Lead action routes: assign + interest manual override
// Design: docs/05-RESPONSE.md API section

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createSupabaseClient } from '../lib/supabase';
import { T } from '../lib/table-names';
import type { Lead } from '@madmedsales/shared';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const VALID_INTEREST_LEVELS = ['cold', 'warming', 'warm', 'hot'] as const;
type ValidInterestLevel = typeof VALID_INTEREST_LEVELS[number];

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', authMiddleware);

// PUT /:id/assign — 영업 담당자 배정
app.put('/:id/assign', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');
    const { assigned_to } = await c.req.json<{ assigned_to: string }>();

    if (!assigned_to || typeof assigned_to !== 'string' || assigned_to.trim() === '') {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'assigned_to (이메일 또는 user_id)는 필수입니다.' } },
        400
      );
    }

    const { data: lead, error: leadErr } = await supabase
      .from(T.leads)
      .select('id, assigned_to')
      .eq('id', id)
      .single();

    if (leadErr || !lead) {
      return c.json(
        { success: false, error: { code: 'LEAD_NOT_FOUND', message: '리드를 찾을 수 없습니다.' } },
        404
      );
    }

    const { data, error } = await supabase
      .from(T.leads)
      .update({
        assigned_to: assigned_to.trim(),
        assigned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      return c.json(
        { success: false, error: { code: 'ASSIGN_ERROR', message: error?.message ?? 'Failed to assign lead' } },
        500
      );
    }

    await supabase.from(T.lead_activities).insert({
      lead_id: id,
      activity_type: 'sales_assigned',
      title: `영업 담당자 배정: ${assigned_to.trim()}`,
      description: `이전 담당자: ${(lead as Record<string, unknown>)['assigned_to'] ?? '없음'}`,
      metadata: {
        assigned_to: assigned_to.trim(),
        previous_assigned_to: (lead as Record<string, unknown>)['assigned_to'] ?? null,
      },
      actor: 'admin',
    });

    return c.json({ success: true, data: data as Lead });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'ASSIGN_ERROR', message } }, 500);
  }
});

// PUT /:id/interest — 관심도 수동 변경
app.put('/:id/interest', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');
    const { interest_level } = await c.req.json<{ interest_level: string }>();

    if (!interest_level || !VALID_INTEREST_LEVELS.includes(interest_level as ValidInterestLevel)) {
      return c.json(
        {
          success: false,
          error: {
            code: 'INVALID_INPUT',
            message: `interest_level은 ${VALID_INTEREST_LEVELS.join(', ')} 중 하나여야 합니다.`,
          },
        },
        400
      );
    }

    const { data: lead, error: leadErr } = await supabase
      .from(T.leads)
      .select('id, interest_level')
      .eq('id', id)
      .single();

    if (leadErr || !lead) {
      return c.json(
        { success: false, error: { code: 'LEAD_NOT_FOUND', message: '리드를 찾을 수 없습니다.' } },
        404
      );
    }

    const { data, error } = await supabase
      .from(T.leads)
      .update({ interest_level, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      return c.json(
        { success: false, error: { code: 'UPDATE_ERROR', message: error?.message ?? 'Failed' } },
        500
      );
    }

    await supabase.from(T.lead_activities).insert({
      lead_id: id,
      activity_type: 'note_added',
      title: `관심도 수동 변경: ${(lead as Record<string, unknown>)['interest_level']} → ${interest_level}`,
      metadata: {
        previous_interest_level: (lead as Record<string, unknown>)['interest_level'],
        new_interest_level: interest_level,
        manual_override: true,
      },
      actor: 'admin',
    });

    return c.json({ success: true, data: data as Lead });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'INTEREST_UPDATE_ERROR', message } }, 500);
  }
});

export default app;
