import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createSupabaseClient } from '../lib/supabase';
import { T } from '../lib/table-names';
import type { Lead } from '@madmedsales/shared';
import leadsActionsApp from './leads-actions';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', authMiddleware);

// 액션 라우트 마운트 (assign, interest)
app.route('/', leadsActionsApp);

// GET / — 리드 목록 (필터, 검색, 페이지네이션)
app.get('/', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10), 100);
    const offset = parseInt(c.req.query('offset') || '0', 10);
    const grade = c.req.query('grade');
    const stage = c.req.query('stage');
    const interestLevel = c.req.query('interest_level');
    const search = c.req.query('search');

    let query = supabase
      .from(T.leads)
      .select('*', { count: 'exact' });

    if (grade) query = query.eq('grade', grade);
    if (stage) query = query.eq('stage', stage);
    if (interestLevel) query = query.eq('interest_level', interestLevel);
    if (search) query = query.or(`contact_name.ilike.%${search}%,contact_email.ilike.%${search}%`);

    const { data, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw new Error(error.message);

    return c.json({
      success: true,
      data: { leads: (data ?? []) as Lead[], total: count ?? 0 },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'LEADS_FETCH_ERROR', message } }, 500);
  }
});

// GET /:id — 리드 상세 (병원, 스코어링, 장비, 시술 포함)
app.get('/:id', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');

    const { data: lead, error: leadErr } = await supabase
      .from(T.leads)
      .select('*')
      .eq('id', id)
      .single();

    if (leadErr || !lead) {
      return c.json(
        { success: false, error: { code: 'LEAD_NOT_FOUND', message: '리드를 찾을 수 없습니다.' } },
        404
      );
    }

    const hospitalId = lead.hospital_id as string;
    const productId = lead.product_id as string | null;

    const [hospitalRes, scoringRes, equipRes, treatRes] = await Promise.all([
      supabase.from(T.hospitals).select('name, address, sido, sigungu, department, email, phone').eq('id', hospitalId).single(),
      productId
        ? supabase.from(T.product_match_scores).select('*').eq('hospital_id', hospitalId).eq('product_id', productId).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from(T.hospital_equipments).select('equipment_name, equipment_category').eq('hospital_id', hospitalId),
      supabase.from(T.hospital_treatments).select('treatment_name, treatment_category, price_min').eq('hospital_id', hospitalId),
    ]);

    return c.json({
      success: true,
      data: {
        lead: lead as Lead,
        hospital: hospitalRes.data ?? {},
        scoring: scoringRes.data ?? null,
        equipments: equipRes.data ?? [],
        treatments: treatRes.data ?? [],
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'LEAD_DETAIL_ERROR', message } }, 500);
  }
});

// GET /:id/activities — 리드 활동 내역
app.get('/:id/activities', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');

    const { data, error } = await supabase
      .from(T.lead_activities)
      .select('id, lead_id, activity_type, title, description, actor, created_at')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    return c.json({ success: true, data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'ACTIVITIES_ERROR', message } }, 500);
  }
});

// GET /:id/emails — 리드 이메일 목록 (본문 + 열람/클릭 여부 포함)
app.get('/:id/emails', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');

    const { data, error } = await supabase
      .from(T.emails)
      .select(`
        id, lead_id, subject, body_html, body_text,
        status, sent_at, step_number, created_at,
        sales_email_events(event_type, created_at)
      `)
      .eq('lead_id', id)
      .order('created_at', { ascending: false });

    if (error) throw new Error(error.message);

    const emails = (data ?? []).map((email) => {
      const events = (email.sales_email_events ?? []) as { event_type: string; created_at: string }[];
      return {
        id: email.id,
        lead_id: email.lead_id,
        subject: email.subject,
        body_html: email.body_html,
        body_text: email.body_text,
        status: email.status,
        sent_at: email.sent_at,
        step_number: email.step_number,
        created_at: email.created_at,
        opened_at: events.find((e) => e.event_type === 'opened')?.created_at ?? null,
        clicked_at: events.find((e) => e.event_type === 'clicked')?.created_at ?? null,
      };
    });

    return c.json({ success: true, data: { emails } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'LEAD_EMAILS_ERROR', message } }, 500);
  }
});

// PATCH /:id/stage — 리드 단계 변경
app.patch('/:id/stage', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');
    const { stage } = await c.req.json<{ stage: string }>();

    if (!stage) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'stage is required' } },
        400
      );
    }

    const { data, error } = await supabase
      .from(T.leads)
      .update({ stage, updated_at: new Date().toISOString() })
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
      activity_type: 'stage_changed',
      title: `단계 변경: ${stage}`,
      actor: 'admin',
    });

    return c.json({ success: true, data: data as Lead });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'STAGE_UPDATE_ERROR', message } }, 500);
  }
});

export default app;
