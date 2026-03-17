import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase.js';
import { profileSingleHospital } from '../services/scoring/profiler.js';
import { matchSingleHospitalProduct } from '../services/scoring/matcher.js';
import { autoCreateLeadFromMatch } from '../services/scoring/lead-generator.js';
import { T } from '../lib/table-names';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
  NAVER_CLIENT_ID?: string;
  NAVER_CLIENT_SECRET?: string;
};

const scoring = new Hono<{ Bindings: Bindings }>();

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

  const result = await profileSingleHospital(supabase, hospital_id, {
    NAVER_CLIENT_ID: c.env.NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET: c.env.NAVER_CLIENT_SECRET,
  });

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
    .from(T.hospital_profiles)
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
    .from(T.product_match_scores)
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

// POST /batch-profile - 전체 병원 프로파일 배치 생성 (청크 병렬)
scoring.post('/batch-profile', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const body: unknown = await c.req.json();

  const { filters, skip_existing, chunk_size } = (body ?? {}) as {
    filters?: { min_quality?: number; department?: string; sido?: string };
    skip_existing?: boolean;
    chunk_size?: number;
  };

  let query = supabase
    .from(T.hospitals)
    .select('id')
    .eq('status', 'active')
    .eq('is_target', true)
    .gte('data_quality_score', filters?.min_quality ?? 50);

  if (filters?.department) query = query.eq('department', filters.department);
  if (filters?.sido) query = query.eq('sido', filters.sido);

  const { data: hospitals, error } = await query;

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  if (!hospitals || hospitals.length === 0) {
    return c.json({ success: true, data: { total: 0, skipped: 0, processed: 0, failed: 0 } });
  }

  let toProcess = hospitals;
  let skipped = 0;

  if (skip_existing !== false) {
    const { data: existing } = await supabase
      .from(T.hospital_profiles)
      .select('hospital_id');

    const existingSet = new Set((existing ?? []).map((r) => r.hospital_id as string));
    toProcess = hospitals.filter((h) => !existingSet.has(h.id as string));
    skipped = hospitals.length - toProcess.length;
  }

  const batchSize = Math.min(chunk_size ?? 10, 20);
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < toProcess.length; i += batchSize) {
    const chunk = toProcess.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map((h) => profileSingleHospital(supabase, h.id as string, {
        NAVER_CLIENT_ID: c.env.NAVER_CLIENT_ID,
        NAVER_CLIENT_SECRET: c.env.NAVER_CLIENT_SECRET,
      }))
    );
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success) processed++;
      else failed++;
    }
  }

  return c.json({ success: true, data: { total: hospitals.length, skipped, processed, failed } });
});

// POST /batch-match - 전체 병원×제품 매칭 배치 실행 (청크 병렬)
scoring.post('/batch-match', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const body: unknown = await c.req.json();

  const { product_id, filters, auto_lead, chunk_size } = (body ?? {}) as {
    product_id?: string;
    filters?: { min_quality?: number; profile_grade?: string };
    auto_lead?: boolean;
    chunk_size?: number;
  };

  if (!product_id) {
    return c.json(
      { success: false, error: { code: 'MISSING_PARAMS', message: 'product_id가 필요합니다.' } },
      400
    );
  }

  // 프로파일이 있는 병원만 대상
  let query = supabase
    .from(T.hospital_profiles)
    .select('hospital_id');

  if (filters?.profile_grade) query = query.eq('profile_grade', filters.profile_grade);

  const { data: profiles, error } = await query;

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  if (!profiles || profiles.length === 0) {
    return c.json({ success: true, data: { total: 0, processed: 0, failed: 0, leads_created: 0 } });
  }

  const batchSize = Math.min(chunk_size ?? 10, 20);
  let processed = 0;
  let failed = 0;
  let leadsCreated = 0;
  const gradeDistribution: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, EXCLUDE: 0 };

  for (let i = 0; i < profiles.length; i += batchSize) {
    const chunk = profiles.slice(i, i + batchSize);

    const matchResults = await Promise.allSettled(
      chunk.map((p) => matchSingleHospitalProduct(supabase, p.hospital_id as string, product_id))
    );

    // 매칭 성공 건 수집 후 리드 생성도 청크 병렬
    const leadPromises: Promise<{ created: boolean }>[] = [];

    for (const r of matchResults) {
      if (r.status === 'fulfilled' && r.value.success && r.value.matchScore) {
        processed++;
        const g = r.value.matchScore.grade as string;
        if (g in gradeDistribution) gradeDistribution[g]++;
        if (auto_lead !== false) {
          leadPromises.push(autoCreateLeadFromMatch(supabase, r.value.matchScore));
        }
      } else {
        failed++;
      }
    }

    if (leadPromises.length > 0) {
      const leadResults = await Promise.allSettled(leadPromises);
      for (const lr of leadResults) {
        if (lr.status === 'fulfilled' && lr.value.created) leadsCreated++;
      }
    }
  }

  return c.json({
    success: true,
    data: {
      total: profiles.length,
      processed,
      failed,
      leads_created: leadsCreated,
      grade_distribution: gradeDistribution,
    },
  });
});

// POST /rescore - 특정 제품 전체 재채점 (기존 scores 초기화 후 재생성)
scoring.post('/rescore', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const body: unknown = await c.req.json();

  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const { product_id, dry_run = false } = body as { product_id?: string; dry_run?: boolean };

  if (!product_id) {
    return c.json(
      { success: false, error: { code: 'MISSING_PARAMS', message: 'product_id가 필요합니다.' } },
      400
    );
  }

  const startedAt = Date.now();

  // 1. 현재 등급 분포 스냅샷
  const { data: beforeData } = await supabase
    .from(T.product_match_scores)
    .select('grade')
    .eq('product_id', product_id);

  const before: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, EXCLUDE: 0 };
  for (const row of beforeData ?? []) {
    const g = row.grade as string;
    if (g in before) before[g]++;
  }

  if (dry_run) {
    // dry_run: 저장 없이 현재 분포만 반환
    return c.json({
      success: true,
      data: { dry_run: true, before, after: null, processed: 0, duration_ms: Date.now() - startedAt },
    });
  }

  // 2. 기존 매칭 스코어 삭제
  const { error: delErr } = await supabase
    .from(T.product_match_scores)
    .delete()
    .eq('product_id', product_id);

  if (delErr) {
    return c.json(
      { success: false, error: { code: 'DELETE_FAILED', message: delErr.message } },
      500
    );
  }

  // 3. 프로파일 있는 병원 대상 재채점 (청크 병렬)
  const { data: profiles, error: profErr } = await supabase
    .from(T.hospital_profiles)
    .select('hospital_id');

  if (profErr || !profiles) {
    return c.json(
      { success: false, error: { code: 'PROFILE_FETCH_FAILED', message: profErr?.message ?? 'unknown' } },
      500
    );
  }

  const batchSize = 10;
  let processed = 0;
  let failed = 0;
  let leadsCreated = 0;
  const after: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, EXCLUDE: 0 };

  for (let i = 0; i < profiles.length; i += batchSize) {
    const chunk = profiles.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      chunk.map((p) => matchSingleHospitalProduct(supabase, p.hospital_id as string, product_id))
    );

    const leadPromises: Promise<{ created: boolean }>[] = [];

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value.success && r.value.matchScore) {
        processed++;
        const g = r.value.matchScore.grade as string;
        if (g in after) after[g]++;
        leadPromises.push(autoCreateLeadFromMatch(supabase, r.value.matchScore));
      } else {
        failed++;
        after['EXCLUDE']++;
      }
    }

    if (leadPromises.length > 0) {
      const leadResults = await Promise.allSettled(leadPromises);
      for (const lr of leadResults) {
        if (lr.status === 'fulfilled' && lr.value.created) leadsCreated++;
      }
    }
  }

  return c.json({
    success: true,
    data: {
      dry_run: false,
      before,
      after,
      total: profiles.length,
      processed,
      failed,
      leads_created: leadsCreated,
      duration_ms: Date.now() - startedAt,
    },
  });
});

// GET /distribution - 등급 분포 통계 (v3.2: product_match_scores 기반)
scoring.get('/distribution', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const productId = c.req.query('product_id');

  // 프로파일 등급 분포
  const { data: profileData } = await supabase
    .from(T.hospital_profiles)
    .select('profile_grade');

  const profileDistribution: Record<string, number> = { PRIME: 0, HIGH: 0, MID: 0, LOW: 0 };
  for (const row of profileData ?? []) {
    const g = row.profile_grade as string;
    if (g in profileDistribution) profileDistribution[g]++;
  }

  // 매칭 등급 분포
  let matchQuery = supabase
    .from(T.product_match_scores)
    .select('grade');

  if (productId) matchQuery = matchQuery.eq('product_id', productId);

  const { data: matchData } = await matchQuery;

  const matchDistribution: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, EXCLUDE: 0 };
  for (const row of matchData ?? []) {
    const g = row.grade as string;
    if (g in matchDistribution) matchDistribution[g]++;
  }

  return c.json({
    success: true,
    data: {
      profile_distribution: profileDistribution,
      match_distribution: matchDistribution,
      total_profiled: (profileData ?? []).length,
      total_matched: (matchData ?? []).length,
    },
  });
});

export default scoring;
