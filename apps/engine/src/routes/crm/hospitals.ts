import { Hono } from 'hono';
import { createSupabaseClient } from '../../lib/supabase.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const hospitals = new Hono<{ Bindings: Bindings }>();

// ===== GET /summary — 통계 =====
hospitals.get('/summary', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const tenantId = c.req.query('tenant_id');

  let query = supabase.from('crm_hospitals').select('id, customer_grade, health_status');
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  const list = data ?? [];
  const summary = {
    total: list.length,
    byGrade: {
      VIP: list.filter((h) => h.customer_grade === 'VIP').length,
      A: list.filter((h) => h.customer_grade === 'A').length,
      B: list.filter((h) => h.customer_grade === 'B').length,
      C: list.filter((h) => h.customer_grade === 'C').length,
    },
    byHealth: {
      green: list.filter((h) => h.health_status === 'green').length,
      yellow: list.filter((h) => h.health_status === 'yellow').length,
      orange: list.filter((h) => h.health_status === 'orange').length,
      red: list.filter((h) => h.health_status === 'red').length,
    },
    attentionCount: list.filter((h) => h.health_status === 'orange' || h.health_status === 'red').length,
  };

  return c.json({ success: true, data: summary });
});

// ===== GET / — 병원 목록 =====
hospitals.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const tenantId = c.req.query('tenant_id');
  const search = c.req.query('search');
  const region = c.req.query('region');
  const grade = c.req.query('customer_grade');
  const health = c.req.query('health_status');
  const franchiseId = c.req.query('franchise_id');
  const page = Math.max(1, Number(c.req.query('page') ?? '1'));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? '20')));
  const offset = (page - 1) * limit;

  // Count query
  let countQuery = supabase.from('crm_hospitals').select('id', { count: 'exact', head: true });
  if (tenantId) countQuery = countQuery.eq('tenant_id', tenantId);
  if (search) countQuery = countQuery.ilike('name', `%${search}%`);
  if (region) countQuery = countQuery.eq('region', region);
  if (grade) countQuery = countQuery.eq('customer_grade', grade);
  if (health) countQuery = countQuery.eq('health_status', health);
  if (franchiseId) countQuery = countQuery.eq('franchise_id', franchiseId);

  const { count, error: countError } = await countQuery;
  if (countError) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: countError.message } }, 500);
  }

  // Data query — include contacts & equipment for list view
  let query = supabase
    .from('crm_hospitals')
    .select(`
      *,
      franchise:franchise_id (id, name),
      assignee:assigned_to (id, name),
      crm_contacts (id, name, role, is_primary),
      crm_equipment (id, model_variant, serial_number, status, product:product_id (name))
    `)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (tenantId) query = query.eq('tenant_id', tenantId);
  if (search) query = query.ilike('name', `%${search}%`);
  if (region) query = query.eq('region', region);
  if (grade) query = query.eq('customer_grade', grade);
  if (health) query = query.eq('health_status', health);
  if (franchiseId) query = query.eq('franchise_id', franchiseId);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  const total = count ?? 0;

  return c.json({
    success: true,
    data: data ?? [],
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ===== GET /:id — 병원 상세 =====
hospitals.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const [hospitalRes, contactsRes, equipmentRes] = await Promise.all([
    supabase
      .from('crm_hospitals')
      .select(`
        *,
        franchise:franchise_id (id, name, total_branches, equipped_branches),
        assignee:assigned_to (id, name, email)
      `)
      .eq('id', id)
      .single(),
    supabase
      .from('crm_contacts')
      .select('*')
      .eq('hospital_id', id)
      .order('is_primary', { ascending: false }),
    supabase
      .from('crm_equipment')
      .select(`
        *,
        product:product_id (id, name, model_variants, warranty_months)
      `)
      .eq('hospital_id', id)
      .order('delivered_at', { ascending: false }),
  ]);

  if (hospitalRes.error || !hospitalRes.data) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '병원을 찾을 수 없습니다.' } }, 404);
  }

  return c.json({
    success: true,
    data: {
      ...hospitalRes.data,
      contacts: contactsRes.data ?? [],
      equipment: equipmentRes.data ?? [],
    },
  });
});

// ===== POST / — 병원 생성 =====
hospitals.post('/', async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    name: string;
    branch_name?: string;
    address?: string;
    region?: string;
    phone?: string;
    email?: string;
    website?: string;
    kakao_channel?: string;
    customer_grade?: string;
    health_status?: string;
    franchise_id?: string;
    assigned_to?: string;
    report_enabled?: boolean;
    report_tier?: string;
    hospital_ref_id?: string;
    tags?: string[];
    notes?: string;
  }>();

  if (!body.tenant_id || !body.name?.trim()) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'tenant_id와 name은 필수입니다.' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_hospitals')
    .insert({
      tenant_id: body.tenant_id,
      name: body.name.trim(),
      branch_name: body.branch_name ?? null,
      address: body.address ?? null,
      region: body.region ?? null,
      phone: body.phone ?? null,
      email: body.email ?? null,
      website: body.website ?? null,
      kakao_channel: body.kakao_channel ?? null,
      customer_grade: body.customer_grade ?? 'B',
      health_status: body.health_status ?? 'green',
      franchise_id: body.franchise_id ?? null,
      assigned_to: body.assigned_to ?? null,
      report_enabled: body.report_enabled ?? true,
      report_tier: body.report_tier ?? 'lite',
      hospital_ref_id: body.hospital_ref_id ?? null,
      tags: body.tags ?? null,
      notes: body.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data }, 201);
});

// ===== PATCH /:id — 병원 수정 =====
hospitals.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_hospitals')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

// ===== DELETE /:id — 병원 삭제 =====
hospitals.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const { error } = await supabase.from('crm_hospitals').delete().eq('id', id);
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true });
});

export default hospitals;
