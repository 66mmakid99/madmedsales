// v1.0 - 2026-03-17
// 콜드메일 캠페인 관리 API
// 관리자 컨펌 기반 이메일 발송 파이프라인

import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createSupabaseClient } from '../lib/supabase';
import { T } from '../lib/table-names';
import type { EmailCampaign, CampaignEmail } from '@madmedsales/shared';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', authMiddleware);

// ─── GET / — 캠페인 목록 ───────────────────────────────
app.get('/', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const limit  = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const status = c.req.query('status');

    let query = supabase
      .from(T.email_campaigns)
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);

    return c.json({
      success: true,
      data: { campaigns: (data ?? []) as EmailCampaign[], total: count ?? 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CAMPAIGNS_FETCH_ERROR', message } }, 500);
  }
});

// ─── GET /:id — 캠페인 상세 ───────────────────────────
app.get('/:id', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const campaignId = c.req.param('id');

    const [{ data, error }, { count: draftFailed }, { count: pendingCount }] = await Promise.all([
      supabase.from(T.email_campaigns).select('*').eq('id', campaignId).single(),
      supabase.from(T.campaign_emails)
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .eq('admin_note', 'draft_failed'),
      supabase.from(T.campaign_emails)
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId)
        .eq('status', 'pending'),
    ]);

    if (error || !data) {
      return c.json({ success: false, error: { code: 'CAMPAIGN_NOT_FOUND', message: '캠페인을 찾을 수 없습니다.' } }, 404);
    }

    return c.json({
      success: true,
      data: {
        ...data,
        draft_failed_count: draftFailed ?? 0,
        pending_count: pendingCount ?? 0,
      } as EmailCampaign,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CAMPAIGN_FETCH_ERROR', message } }, 500);
  }
});

// ─── GET /:id/emails — 캠페인 이메일 목록 ─────────────
app.get('/:id/emails', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const campaignId = c.req.param('id');
    const limit  = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const status = c.req.query('status');

    let query = supabase
      .from(T.campaign_emails)
      .select('*', { count: 'exact' })
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: true });

    if (status) query = query.eq('status', status);

    const { data, error, count } = await query.range(offset, offset + limit - 1);
    if (error) throw new Error(error.message);

    return c.json({
      success: true,
      data: { emails: (data ?? []) as CampaignEmail[], total: count ?? 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CAMPAIGN_EMAILS_ERROR', message } }, 500);
  }
});

// ─── PATCH /:id — 캠페인 메타 업데이트 (status, notes) ─
app.patch('/:id', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const body = await c.req.json() as { status?: string; notes?: string };

    const allowedStatus = ['draft', 'reviewing', 'paused'];
    if (body.status && !allowedStatus.includes(body.status)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_STATUS', message: `허용 status: ${allowedStatus.join(', ')}` },
      }, 400);
    }

    const { error } = await supabase
      .from(T.email_campaigns)
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', c.req.param('id'));

    if (error) throw new Error(error.message);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CAMPAIGN_UPDATE_ERROR', message } }, 500);
  }
});

// ─── PATCH /:id/emails/:eid — 개별 이메일 내용/상태 수정 ─
app.patch('/:id/emails/:eid', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const body = await c.req.json() as {
      subject?: string;
      body_html?: string;
      body_text?: string;
    };

    const { error } = await supabase
      .from(T.campaign_emails)
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', c.req.param('eid'))
      .eq('campaign_id', c.req.param('id'));

    if (error) throw new Error(error.message);
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'EMAIL_UPDATE_ERROR', message } }, 500);
  }
});

// ─── POST /:id/emails/:eid/approve — 개별 이메일 승인 ──
app.post('/:id/emails/:eid/approve', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const reviewedBy = c.req.header('x-admin-email') ?? 'admin';

    const { error } = await supabase
      .from(T.campaign_emails)
      .update({
        status: 'approved',
        admin_note: null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', c.req.param('eid'))
      .eq('campaign_id', c.req.param('id'))
      .in('status', ['pending', 'rejected']);

    if (error) throw new Error(error.message);

    // 캠페인 approved_count 재집계
    await recalcCampaignCounts(supabase, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'EMAIL_APPROVE_ERROR', message } }, 500);
  }
});

// ─── POST /:id/emails/:eid/reject — 개별 이메일 반려 ──
app.post('/:id/emails/:eid/reject', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const body = await c.req.json() as { admin_note?: string };
    const reviewedBy = c.req.header('x-admin-email') ?? 'admin';

    const { error } = await supabase
      .from(T.campaign_emails)
      .update({
        status: 'rejected',
        admin_note: body.admin_note ?? '반려',
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewedBy,
        updated_at: new Date().toISOString(),
      })
      .eq('id', c.req.param('eid'))
      .eq('campaign_id', c.req.param('id'))
      .in('status', ['pending', 'approved']);

    if (error) throw new Error(error.message);

    await recalcCampaignCounts(supabase, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'EMAIL_REJECT_ERROR', message } }, 500);
  }
});

// ─── POST /:id/emails/bulk-reject — 일괄 반려 ─────────
app.post('/:id/emails/bulk-reject', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const body = await c.req.json() as { ids: string[]; admin_note?: string };
    const reviewedBy = c.req.header('x-admin-email') ?? 'admin';

    if (!body.ids || body.ids.length === 0) {
      return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'ids 배열 필요' } }, 400);
    }

    const { error } = await supabase
      .from(T.campaign_emails)
      .update({
        status: 'rejected',
        admin_note: body.admin_note ?? '일괄 반려',
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewedBy,
        updated_at: new Date().toISOString(),
      })
      .in('id', body.ids)
      .eq('campaign_id', c.req.param('id'))
      .in('status', ['pending', 'approved']);

    if (error) throw new Error(error.message);
    await recalcCampaignCounts(supabase, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'BULK_REJECT_ERROR', message } }, 500);
  }
});

// ─── POST /:id/approve — 캠페인 전체 승인 ─────────────
app.post('/:id/approve', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const campaignId = c.req.param('id');
    const approvedBy = c.req.header('x-admin-email') ?? 'admin';

    // 현재 캠페인 확인
    const { data: camp } = await supabase
      .from(T.email_campaigns)
      .select('status, approved_count')
      .eq('id', campaignId)
      .single();

    if (!camp || camp.status !== 'reviewing') {
      return c.json({
        success: false,
        error: { code: 'INVALID_STATUS', message: `status가 'reviewing'인 캠페인만 승인 가능합니다.` },
      }, 409);
    }

    if ((camp.approved_count ?? 0) === 0) {
      return c.json({
        success: false,
        error: { code: 'NO_APPROVED_EMAILS', message: '승인된 이메일이 없습니다. 먼저 이메일을 개별 승인하세요.' },
      }, 409);
    }

    const { error } = await supabase
      .from(T.email_campaigns)
      .update({
        status: 'approved',
        approved_by: approvedBy,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', campaignId);

    if (error) throw new Error(error.message);
    return c.json({ success: true, data: { message: '캠페인 승인 완료. 이제 발송 스크립트를 실행하세요.' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CAMPAIGN_APPROVE_ERROR', message } }, 500);
  }
});

// ─── POST /:id/emails/bulk-approve — 일괄 승인 ────────
app.post('/:id/emails/bulk-approve', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const body = await c.req.json() as { ids: string[] };
    const reviewedBy = c.req.header('x-admin-email') ?? 'admin';

    if (!body.ids || body.ids.length === 0) {
      return c.json({ success: false, error: { code: 'INVALID_INPUT', message: 'ids 배열 필요' } }, 400);
    }

    const { error } = await supabase
      .from(T.campaign_emails)
      .update({
        status: 'approved',
        admin_note: null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: reviewedBy,
        updated_at: new Date().toISOString(),
      })
      .in('id', body.ids)
      .eq('campaign_id', c.req.param('id'))
      .in('status', ['pending', 'rejected']);

    if (error) throw new Error(error.message);

    await recalcCampaignCounts(supabase, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'BULK_APPROVE_ERROR', message } }, 500);
  }
});

// ─── 캠페인 카운트 재집계 헬퍼 ────────────────────────
async function recalcCampaignCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  campaignId: string,
): Promise<void> {
  const statuses = ['pending', 'approved', 'rejected', 'sent'] as const;
  const counts: Record<string, number> = {};

  for (const s of statuses) {
    const { count } = await supabase
      .from(T.campaign_emails)
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', campaignId)
      .eq('status', s);
    counts[`${s}_count`] = count ?? 0;
  }

  await supabase
    .from(T.email_campaigns)
    .update({ ...counts, updated_at: new Date().toISOString() })
    .eq('id', campaignId);
}

export default app;
