/**
 * 시나리오 엔진 API 라우트
 * /api/scenarios
 * v4.0 - 2026-03-10
 */
import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase';
import { authMiddleware } from '../middleware/auth';
import { generateScenario, generateScenariosForProduct } from '../services/scenario/scenario-engine';
import { updateBuyingStage } from '../services/scenario/buying-stage';
import { createNegativeNote, getRejectionDistribution, inferRejectionCode } from '../services/scenario/negative-notes';
import { calculateRewardsForProduct } from '../services/scenario/reward-calculator';
import { listPromotionCandidates, promoteToRule, approveRule, applyActiveRules } from '../services/scenario/rule-promoter';
import { T } from '../lib/table-names';
import type { RejectionCode } from '../services/scenario/negative-notes';
import { sanitizeInsightForApi } from '../services/scenario/insight-sanitizer';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', authMiddleware);

// ─── 시나리오 ───────────────────────────────────

/** 단일 시나리오 생성 */
app.post('/generate', async (c) => {
  const { hospitalId, productId } = await c.req.json<{ hospitalId: string; productId: string }>();
  if (!hospitalId || !productId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAMS', message: 'hospitalId, productId 필수' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const result = await generateScenario(supabase, { hospitalId, productId });

  if (!result) {
    return c.json({ success: false, error: { code: 'SCENARIO_FAILED', message: '시나리오 생성 불가 (등급 C 또는 페르소나 없음)' } }, 400);
  }

  return c.json({ success: true, data: result });
});

/** 제품별 시나리오 일괄 생성 */
app.post('/generate-batch', async (c) => {
  const { productId } = await c.req.json<{ productId: string }>();
  if (!productId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAMS', message: 'productId 필수' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const result = await generateScenariosForProduct(supabase, productId);

  return c.json({ success: true, data: result });
});

/** 시나리오 목록 조회 */
app.get('/', async (c) => {
  const productId = c.req.query('productId');
  const status = c.req.query('status');
  const sequenceType = c.req.query('sequenceType');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const supabase = createSupabaseClient(c.env);
  let query = supabase
    .from(T.scenarios)
    .select('*, hospitals!inner(name, address)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (productId) query = query.eq('product_id', productId);
  if (status) query = query.eq('status', status);
  if (sequenceType) query = query.eq('sequence_type', sequenceType);

  const { data, count, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } }, 500);
  }

  return c.json({ success: true, data, total: count });
});

// ─── 구매단계 ───────────────────────────────────

/** 구매단계 업데이트 */
app.post('/buying-stage', async (c) => {
  const { hospitalId, productId, signalType, signalDetail } = await c.req.json<{
    hospitalId: string;
    productId: string;
    signalType: string;
    signalDetail: string;
  }>();

  const supabase = createSupabaseClient(c.env);
  const result = await updateBuyingStage(supabase, hospitalId, productId, signalType, signalDetail);

  return c.json({ success: true, data: result });
});

// ─── 오답노트 ───────────────────────────────────

/** 오답노트 생성 */
app.post('/negative-notes', async (c) => {
  const body = await c.req.json<{
    hospitalId: string;
    productId: string;
    rejectionCode?: RejectionCode;
    rejectionDetail?: string;
    source: 'email_reply' | 'phone' | 'demo_feedback';
    insightCardId?: string;
  }>();

  // 거부코드 자동 추론 (명시되지 않은 경우)
  const rejectionCode = body.rejectionCode ?? inferRejectionCode(body.rejectionDetail ?? '');

  const supabase = createSupabaseClient(c.env);
  const result = await createNegativeNote(supabase, {
    hospitalId: body.hospitalId,
    productId: body.productId,
    rejectionCode,
    rejectionDetail: body.rejectionDetail,
    source: body.source,
    insightCardId: body.insightCardId,
  });

  if (!result) {
    return c.json({ success: false, error: { code: 'INSERT_FAILED', message: '오답노트 생성 실패' } }, 500);
  }

  return c.json({ success: true, data: result });
});

/** 거부코드 분포 조회 */
app.get('/negative-notes/distribution', async (c) => {
  const productId = c.req.query('productId');
  if (!productId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAMS', message: 'productId 필수' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const dist = await getRejectionDistribution(supabase, productId);

  return c.json({ success: true, data: dist });
});

/** 오답노트 목록 */
app.get('/negative-notes', async (c) => {
  const productId = c.req.query('productId');
  const rejectionCode = c.req.query('rejectionCode');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const supabase = createSupabaseClient(c.env);
  let query = supabase
    .from(T.negative_notes)
    .select('*, hospitals!inner(name)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (productId) query = query.eq('product_id', productId);
  if (rejectionCode) query = query.eq('rejection_code', rejectionCode);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

// ─── Reward & 규칙 승격 ────────────────────────

/** Reward 계산 */
app.get('/rewards', async (c) => {
  const productId = c.req.query('productId');
  if (!productId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAMS', message: 'productId 필수' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const rewards = await calculateRewardsForProduct(supabase, productId);

  return c.json({ success: true, data: rewards });
});

/** 승격 후보 목록 */
app.get('/rules/candidates', async (c) => {
  const productId = c.req.query('productId');
  if (!productId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAMS', message: 'productId 필수' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const candidates = await listPromotionCandidates(supabase, productId);

  return c.json({ success: true, data: candidates });
});

/** 시나리오 → 규칙 승격 */
app.post('/rules/promote', async (c) => {
  const { scenarioId } = await c.req.json<{ scenarioId: string }>();

  const supabase = createSupabaseClient(c.env);
  const result = await promoteToRule(supabase, scenarioId);

  if (!result) {
    return c.json({ success: false, error: { code: 'PROMOTION_FAILED', message: '승격 조건 미충족' } }, 400);
  }

  return c.json({ success: true, data: result });
});

/** 규칙 승인 (관리자) */
app.post('/rules/:ruleId/approve', async (c) => {
  const ruleId = c.req.param('ruleId');
  const { approvedBy } = await c.req.json<{ approvedBy: string }>();

  const supabase = createSupabaseClient(c.env);
  const ok = await approveRule(supabase, ruleId, approvedBy);

  if (!ok) {
    return c.json({ success: false, error: { code: 'APPROVE_FAILED', message: '규칙 승인 실패' } }, 500);
  }

  return c.json({ success: true, data: { ruleId, approved: true } });
});

/** 활성 규칙 목록 */
app.get('/rules', async (c) => {
  const productId = c.req.query('productId');
  const activeOnly = c.req.query('active') === 'true';

  const supabase = createSupabaseClient(c.env);
  let query = supabase
    .from(T.rules)
    .select('*')
    .order('created_at', { ascending: false });

  if (productId) query = query.eq('product_id', productId);
  if (activeOnly) query = query.eq('is_active', true);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

/** 규칙 비활성화 */
app.delete('/rules/:ruleId', async (c) => {
  const ruleId = c.req.param('ruleId');

  const supabase = createSupabaseClient(c.env);
  const { error } = await supabase
    .from(T.rules)
    .update({ is_active: false })
    .eq('id', ruleId);

  if (error) {
    return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: error.message } }, 500);
  }

  return c.json({ success: true, data: { ruleId, deactivated: true } });
});

// ─── Insight Cards (익명화 필수) ────────────────

/** 인사이트 카드 목록 (개인정보 완전 제거) */
app.get('/insights', async (c) => {
  const productId = c.req.query('productId');
  const channel = c.req.query('channel');
  const limit = parseInt(c.req.query('limit') ?? '50', 10);

  const supabase = createSupabaseClient(c.env);
  let query = supabase
    .from(T.insight_cards)
    .select('id, source_channel, raw_text, structured, tags, product_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (productId) query = query.eq('product_id', productId);
  if (channel) query = query.eq('source_channel', channel);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'QUERY_FAILED', message: error.message } }, 500);
  }

  // ⚠️ 모든 카드에 sanitizer 적용 — 개인정보 절대 노출 금지
  const sanitized = (data ?? []).map((card) =>
    sanitizeInsightForApi(card as Record<string, unknown>),
  );

  return c.json({ success: true, data: sanitized });
});

export default app;
