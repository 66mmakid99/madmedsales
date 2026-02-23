import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase.js';
import type { ConfidenceLevel } from '@madmedsales/shared';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const networks = new Hono<{ Bindings: Bindings }>();

// ===== GET / — 네트워크 목록 + 지점 수 통계 =====
networks.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const status = c.req.query('status'); // active | inactive | unverified
  const category = c.req.query('category'); // franchise | network | group
  const search = c.req.query('search');

  let query = supabase
    .from('networks')
    .select('*')
    .order('total_branches', { ascending: false });

  if (status) query = query.eq('status', status);
  if (category) query = query.eq('category', category);
  if (search) query = query.ilike('name', `%${search}%`);

  const { data: networkList, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  // 각 네트워크별 confidence 분포 조회
  const networkIds = (networkList ?? []).map(n => n.id);
  let branchStats: Array<{ network_id: string; confidence: string; count: number }> = [];

  if (networkIds.length > 0) {
    // RPC 없이 전체 branches를 가져와서 집계
    const { data: branches } = await supabase
      .from('network_branches')
      .select('network_id, confidence')
      .in('network_id', networkIds);

    if (branches) {
      const statsMap = new Map<string, Map<string, number>>();
      for (const b of branches) {
        if (!statsMap.has(b.network_id)) statsMap.set(b.network_id, new Map());
        const cMap = statsMap.get(b.network_id)!;
        cMap.set(b.confidence, (cMap.get(b.confidence) ?? 0) + 1);
      }
      for (const [nid, cMap] of statsMap) {
        for (const [conf, cnt] of cMap) {
          branchStats.push({ network_id: nid, confidence: conf, count: cnt });
        }
      }
    }
  }

  // 통계 병합
  const statsMap = new Map<string, { confirmed: number; probable: number; candidate: number; unlikely: number }>();
  for (const s of branchStats) {
    if (!statsMap.has(s.network_id)) {
      statsMap.set(s.network_id, { confirmed: 0, probable: 0, candidate: 0, unlikely: 0 });
    }
    const entry = statsMap.get(s.network_id)!;
    if (s.confidence in entry) {
      entry[s.confidence as keyof typeof entry] = s.count;
    }
  }

  const data = (networkList ?? []).map(n => ({
    ...n,
    confirmed_count: statsMap.get(n.id)?.confirmed ?? 0,
    probable_count: statsMap.get(n.id)?.probable ?? 0,
    candidate_count: statsMap.get(n.id)?.candidate ?? 0,
    unlikely_count: statsMap.get(n.id)?.unlikely ?? 0,
  }));

  return c.json({ success: true, data });
});

// ===== GET /:id — 네트워크 상세 =====
networks.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const { data: network, error } = await supabase
    .from('networks')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !network) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '네트워크를 찾을 수 없습니다.' } }, 404);
  }

  return c.json({ success: true, data: network });
});

// ===== GET /:id/branches — 네트워크 지점 목록 =====
networks.get('/:id/branches', async (c) => {
  const id = c.req.param('id');
  const confidence = c.req.query('confidence') as ConfidenceLevel | undefined;
  const supabase = createSupabaseClient(c.env);

  let query = supabase
    .from('network_branches')
    .select(`
      *,
      hospital:hospital_id (id, name, address, sido, sigungu, phone, website)
    `)
    .eq('network_id', id)
    .order('confidence_score', { ascending: false });

  if (confidence) {
    query = query.eq('confidence', confidence);
  }

  const { data: branches, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data: branches ?? [] });
});

// ===== POST / — 네트워크 생성 =====
networks.post('/', async (c) => {
  const body = await c.req.json<{
    name: string;
    category?: string;
    official_name?: string;
    official_site_url?: string;
    branch_page_url?: string;
    notes?: string;
  }>();

  if (!body.name?.trim()) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'name은 필수입니다.' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('networks')
    .insert({
      name: body.name.trim(),
      category: body.category ?? 'franchise',
      official_name: body.official_name ?? null,
      official_site_url: body.official_site_url ?? null,
      branch_page_url: body.branch_page_url ?? null,
      notes: body.notes ?? null,
      status: 'unverified',
    })
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data }, 201);
});

// ===== PATCH /:id — 네트워크 수정 =====
networks.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Partial<{
    name: string;
    category: string;
    official_name: string;
    official_site_url: string;
    branch_page_url: string;
    status: string;
    notes: string;
  }>>();

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('networks')
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

// ===== PATCH /branches/:branchId/verify — 지점 검증 상태 변경 =====
networks.patch('/branches/:branchId/verify', async (c) => {
  const branchId = c.req.param('branchId');
  const body = await c.req.json<{
    confidence: ConfidenceLevel;
    verification_notes?: string;
  }>();

  if (!body.confidence) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'confidence는 필수입니다.' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);

  // confidence에 따른 score 자동 계산
  const scoreMap: Record<ConfidenceLevel, number> = {
    confirmed: 100,
    probable: 70,
    candidate: 30,
    unlikely: 10,
  };

  const { data, error } = await supabase
    .from('network_branches')
    .update({
      confidence: body.confidence,
      confidence_score: scoreMap[body.confidence],
      verified_at: new Date().toISOString(),
      verified_by: 'manual',
      verification_notes: body.verification_notes ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', branchId)
    .select(`
      *,
      hospital:hospital_id (id, name, address, sido, sigungu, phone, website)
    `)
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  // 검증 로그 기록
  await supabase.from('network_verification_logs').insert({
    network_id: data.network_id,
    branch_id: branchId,
    verification_method: 'manual',
    result: body.confidence === 'confirmed' || body.confidence === 'probable' ? 'match' : 'no_match',
    detail: {
      previous_confidence: data.confidence,
      new_confidence: body.confidence,
      notes: body.verification_notes ?? null,
    },
  });

  return c.json({ success: true, data });
});

// ===== POST /branches/:branchId/remove — 지점 제거 (unlikely 처리) =====
networks.post('/branches/:branchId/remove', async (c) => {
  const branchId = c.req.param('branchId');
  const body = await c.req.json<{ reason?: string }>();

  const supabase = createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from('network_branches')
    .update({
      confidence: 'unlikely',
      confidence_score: 0,
      verified_at: new Date().toISOString(),
      verified_by: 'manual',
      verification_notes: body.reason ?? '수동 제거',
      updated_at: new Date().toISOString(),
    })
    .eq('id', branchId)
    .select('network_id')
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  // 검증 로그
  await supabase.from('network_verification_logs').insert({
    network_id: data.network_id,
    branch_id: branchId,
    verification_method: 'manual',
    result: 'no_match',
    detail: { action: 'removed', reason: body.reason ?? '수동 제거' },
  });

  return c.json({ success: true });
});

// ===== GET /:id/logs — 검증 이력 =====
networks.get('/:id/logs', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const { data: logs, error } = await supabase
    .from('network_verification_logs')
    .select('*')
    .eq('network_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data: logs ?? [] });
});

// ===== GET /summary — 전체 통계 =====
networks.get('/summary', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const [networksRes, branchesRes] = await Promise.all([
    supabase.from('networks').select('id, status'),
    supabase.from('network_branches').select('confidence'),
  ]);

  if (networksRes.error || branchesRes.error) {
    const msg = networksRes.error?.message ?? branchesRes.error?.message ?? '';
    return c.json({ success: false, error: { code: 'DB_ERROR', message: msg } }, 500);
  }

  const nList = networksRes.data ?? [];
  const bList = branchesRes.data ?? [];

  const data = {
    totalNetworks: nList.length,
    activeNetworks: nList.filter(n => n.status === 'active').length,
    unverifiedNetworks: nList.filter(n => n.status === 'unverified').length,
    totalBranches: bList.length,
    confirmedBranches: bList.filter(b => b.confidence === 'confirmed').length,
    probableBranches: bList.filter(b => b.confidence === 'probable').length,
    candidateBranches: bList.filter(b => b.confidence === 'candidate').length,
    unlikelyBranches: bList.filter(b => b.confidence === 'unlikely').length,
  };

  return c.json({ success: true, data });
});

export default networks;
