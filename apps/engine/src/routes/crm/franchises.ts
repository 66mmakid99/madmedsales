import { Hono } from 'hono';
import { createSupabaseClient } from '../../lib/supabase.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const franchises = new Hono<{ Bindings: Bindings }>();

// ===== GET / — 프랜차이즈 목록 (병원 수 enrichment) =====
franchises.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const tenantId = c.req.query('tenant_id');

  let query = supabase
    .from('crm_franchises')
    .select('*')
    .order('name', { ascending: true });

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data: franchiseList, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  const list = franchiseList ?? [];
  if (list.length === 0) {
    return c.json({ success: true, data: [] });
  }

  // 프랜차이즈별 등록 병원 수 조회
  const franchiseIds = list.map((f) => f.id);
  const { data: hospitals } = await supabase
    .from('crm_hospitals')
    .select('franchise_id')
    .in('franchise_id', franchiseIds);

  const countMap = new Map<string, number>();
  for (const h of hospitals ?? []) {
    if (h.franchise_id) {
      countMap.set(h.franchise_id, (countMap.get(h.franchise_id) ?? 0) + 1);
    }
  }

  const enriched = list.map((f) => ({
    ...f,
    hospital_count: countMap.get(f.id) ?? 0,
  }));

  return c.json({ success: true, data: enriched });
});

// ===== POST / — 프랜차이즈 생성 =====
franchises.post('/', async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    name: string;
    total_branches?: number;
    equipped_branches?: number;
    notes?: string;
  }>();

  if (!body.tenant_id || !body.name?.trim()) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'tenant_id와 name은 필수입니다.' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_franchises')
    .insert({
      tenant_id: body.tenant_id,
      name: body.name.trim(),
      total_branches: body.total_branches ?? null,
      equipped_branches: body.equipped_branches ?? 0,
      notes: body.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data }, 201);
});

// ===== PATCH /:id — 프랜차이즈 수정 =====
franchises.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_franchises')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

export default franchises;
