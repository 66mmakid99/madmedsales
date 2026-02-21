import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase.js';
import { getActiveWeights, createWeightVersion } from '../services/scoring/weights.js';
import { runSingleScoring } from '../services/scoring/runner.js';
import { profileSingleHospital } from '../services/scoring/profiler.js';
import { matchSingleHospitalProduct } from '../services/scoring/matcher.js';
import { autoCreateLeadFromMatch } from '../services/scoring/lead-generator.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const scoring = new Hono<{ Bindings: Bindings }>();

// ═══════════════════════════════════════════════════════
// 새 2단계 스코어링 API
// ═══════════════════════════════════════════════════════

// POST /profile - 1단계 병원 프로파일 생성
scoring.post('/profile', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const body: unknown = await c.req.json();

  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const { hospital_id } = body as { hospital_id?: string };

  if (!hospital_id) {
    return c.json(
      { success: false, error: { code: 'MISSING_ID', message: 'hospital_id가 필요합니다.' } },
      400
    );
  }

  const result = await profileSingleHospital(supabase, hospital_id);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: 'PROFILE_FAILED', message: result.error } },
      500
    );
  }

  return c.json({ success: true, data: result.profile });
});

// POST /match - 2단계 제품 매칭 스코어 산출
scoring.post('/match', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const body: unknown = await c.req.json();

  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const { hospital_id, product_id, auto_lead } = body as {
    hospital_id?: string;
    product_id?: string;
    auto_lead?: boolean;
  };

  if (!hospital_id || !product_id) {
    return c.json(
      { success: false, error: { code: 'MISSING_PARAMS', message: 'hospital_id와 product_id가 필요합니다.' } },
      400
    );
  }

  const matchResult = await matchSingleHospitalProduct(supabase, hospital_id, product_id);

  if (!matchResult.success) {
    return c.json(
      { success: false, error: { code: 'MATCH_FAILED', message: matchResult.error } },
      500
    );
  }

  let leadResult = null;
  if (auto_lead !== false && matchResult.matchScore) {
    leadResult = await autoCreateLeadFromMatch(supabase, matchResult.matchScore);
  }

  return c.json({ success: true, data: { matchScore: matchResult.matchScore, lead: leadResult } });
});

// GET /profiles - 프로파일 목록
scoring.get('/profiles', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const grade = c.req.query('grade');
  const minScore = c.req.query('min_score');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = (page - 1) * limit;

  let query = supabase
    .from('hospital_profiles')
    .select('*, hospitals(name, sido, sigungu, department, email)', { count: 'exact' });

  if (grade) query = query.eq('profile_grade', grade);
  if (minScore) query = query.gte('profile_score', parseInt(minScore, 10));

  query = query.order('profile_score', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({
    success: true,
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  });
});

// GET /matches - 매칭 결과 목록
scoring.get('/matches', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const productId = c.req.query('product_id');
  const grade = c.req.query('grade');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = (page - 1) * limit;

  let query = supabase
    .from('product_match_scores')
    .select('*, hospitals(name, sido, sigungu, email), products(name, code)', { count: 'exact' });

  if (productId) query = query.eq('product_id', productId);
  if (grade) query = query.eq('grade', grade);

  query = query.order('total_score', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({
    success: true,
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  });
});

// ═══════════════════════════════════════════════════════
// 기존 API (하위 호환, deprecated)
// ═══════════════════════════════════════════════════════

// POST /run - Run scoring for a single hospital or batch (LEGACY)
scoring.post('/run', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const body: unknown = await c.req.json();

  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const { hospital_id, batch, filters } = body as {
    hospital_id?: string;
    batch?: boolean;
    filters?: { min_quality?: number; department?: string; sido?: string };
  };

  const { weights, version } = await getActiveWeights(supabase);

  if (batch) {
    return await runBatch(c.env, supabase, weights, version, filters);
  }

  if (!hospital_id) {
    return c.json(
      { success: false, error: { code: 'MISSING_ID', message: 'hospital_id가 필요합니다.' } },
      400
    );
  }

  const result = await runSingleScoring(c.env, supabase, hospital_id, weights, version);

  if (!result.success) {
    return c.json(
      { success: false, error: { code: 'SCORING_FAILED', message: result.error } },
      500
    );
  }

  return c.json({ success: true, data: result.data });
});

// GET /weights - Get active weights
scoring.get('/weights', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const { weights, version } = await getActiveWeights(supabase);
  return c.json({ success: true, data: { weights, version } });
});

// PUT /weights - Create new weight version
scoring.put('/weights', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const body: unknown = await c.req.json();

  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const { weights, notes } = body as {
    weights?: {
      equipmentSynergy: number;
      equipmentAge: number;
      revenueImpact: number;
      competitiveEdge: number;
      purchaseReadiness: number;
    };
    notes?: string;
  };

  if (!weights) {
    return c.json(
      { success: false, error: { code: 'MISSING_WEIGHTS', message: 'weights가 필요합니다.' } },
      400
    );
  }

  try {
    await createWeightVersion(supabase, weights, notes ?? '');
    return c.json({ success: true, data: { message: '가중치가 업데이트되었습니다.' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'WEIGHT_ERROR', message } },
      400
    );
  }
});

// GET /results - Scoring results list
scoring.get('/results', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const grade = c.req.query('grade');
  const minScore = c.req.query('min_score');
  const maxScore = c.req.query('max_score');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = (page - 1) * limit;

  let query = supabase
    .from('scoring_results')
    .select('*, hospitals(name, sido, sigungu, department, email)', { count: 'exact' });

  if (grade) query = query.eq('grade', grade);
  if (minScore) query = query.gte('total_score', parseInt(minScore, 10));
  if (maxScore) query = query.lte('total_score', parseInt(maxScore, 10));

  query = query
    .order('total_score', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  return c.json({
    success: true,
    data: data ?? [],
    pagination: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  });
});

// GET /distribution - Grade distribution stats
scoring.get('/distribution', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from('scoring_results')
    .select('grade');

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  const distribution: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, EXCLUDE: 0 };
  for (const row of data ?? []) {
    const g = row.grade as string;
    if (g in distribution) distribution[g]++;
  }

  const total = (data ?? []).length;

  return c.json({
    success: true,
    data: {
      distribution,
      total,
      percentages: {
        S: total > 0 ? Math.round((distribution.S / total) * 100) : 0,
        A: total > 0 ? Math.round((distribution.A / total) * 100) : 0,
        B: total > 0 ? Math.round((distribution.B / total) * 100) : 0,
        C: total > 0 ? Math.round((distribution.C / total) * 100) : 0,
        EXCLUDE: total > 0 ? Math.round((distribution.EXCLUDE / total) * 100) : 0,
      },
    },
  });
});

// --- Batch helper ---

interface WeightValues {
  equipmentSynergy: number;
  equipmentAge: number;
  revenueImpact: number;
  competitiveEdge: number;
  purchaseReadiness: number;
}

async function runBatch(
  env: Bindings,
  supabase: ReturnType<typeof createSupabaseClient>,
  weights: WeightValues,
  version: string,
  filters?: { min_quality?: number; department?: string; sido?: string }
): Promise<Response> {
  let query = supabase
    .from('hospitals')
    .select('id')
    .eq('status', 'active')
    .eq('is_target', true)
    .gte('data_quality_score', filters?.min_quality ?? 50);

  if (filters?.department) query = query.eq('department', filters.department);
  if (filters?.sido) query = query.eq('sido', filters.sido);

  const { data: hospitals, error } = await query;

  if (error) {
    return Response.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      { status: 500 }
    );
  }

  if (!hospitals || hospitals.length === 0) {
    return Response.json({
      success: true,
      data: { processed: 0, message: '스코어링할 병원이 없습니다.' },
    });
  }

  const { data: existingResults } = await supabase
    .from('scoring_results')
    .select('hospital_id')
    .eq('weight_version', version);

  const alreadyScored = new Set(
    (existingResults ?? []).map((r) => r.hospital_id)
  );

  const toProcess = hospitals.filter((h) => !alreadyScored.has(h.id));
  let processed = 0;
  let failed = 0;

  for (const hospital of toProcess) {
    const result = await runSingleScoring(env, supabase, hospital.id, weights, version);
    if (result.success) processed++;
    else failed++;
  }

  return Response.json({
    success: true,
    data: { total: hospitals.length, skipped: alreadyScored.size, processed, failed },
  });
}

export default scoring;
