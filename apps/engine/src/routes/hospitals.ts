import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const hospitals = new Hono<{ Bindings: Bindings }>();

// GET / - Hospital list with filters and pagination
hospitals.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const sido = c.req.query('sido');
  const sigungu = c.req.query('sigungu');
  const department = c.req.query('department');
  const status = c.req.query('status');
  const minScore = c.req.query('min_score');
  const hasEmail = c.req.query('has_email');
  const hasEquipment = c.req.query('has_equipment');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = (page - 1) * limit;

  let query = supabase
    .from('hospitals')
    .select(
      'id, name, address, sido, sigungu, department, hospital_type, phone, email, website, data_quality_score, status, is_target, opened_at, created_at',
      { count: 'exact' }
    );

  if (sido) query = query.eq('sido', sido);
  if (sigungu) query = query.eq('sigungu', sigungu);
  if (department) query = query.eq('department', department);
  if (status) query = query.eq('status', status);
  if (minScore) query = query.gte('data_quality_score', parseInt(minScore, 10));
  if (hasEmail === 'true') query = query.not('email', 'is', null);
  if (hasEmail === 'false') query = query.is('email', null);

  query = query.order('data_quality_score', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  // Filter by equipment presence if requested
  let filteredData = data ?? [];
  if (hasEquipment === 'true' || hasEquipment === 'false') {
    const hospitalIds = filteredData.map((h) => h.id);
    if (hospitalIds.length > 0) {
      const { data: equipHospitals } = await supabase
        .from('hospital_equipments')
        .select('hospital_id')
        .in('hospital_id', hospitalIds);

      const withEquipIds = new Set(
        (equipHospitals ?? []).map((e) => e.hospital_id)
      );

      filteredData =
        hasEquipment === 'true'
          ? filteredData.filter((h) => withEquipIds.has(h.id))
          : filteredData.filter((h) => !withEquipIds.has(h.id));
    }
  }

  return c.json({
    success: true,
    data: filteredData,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
});

// GET /stats - Statistics
hospitals.get('/stats', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const { data: byRegion, error: regionErr } = await supabase
    .from('hospitals')
    .select('sido')
    .eq('status', 'active');

  if (regionErr) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: regionErr.message } },
      500
    );
  }

  const regionCounts: Record<string, number> = {};
  for (const h of byRegion ?? []) {
    const key = h.sido ?? 'unknown';
    regionCounts[key] = (regionCounts[key] ?? 0) + 1;
  }

  const { data: byDept, error: deptErr } = await supabase
    .from('hospitals')
    .select('department')
    .eq('status', 'active');

  if (deptErr) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: deptErr.message } },
      500
    );
  }

  const deptCounts: Record<string, number> = {};
  for (const h of byDept ?? []) {
    const key = h.department ?? 'unknown';
    deptCounts[key] = (deptCounts[key] ?? 0) + 1;
  }

  const { count: totalCount } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: emailCount } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .not('email', 'is', null);

  return c.json({
    success: true,
    data: {
      total: totalCount ?? 0,
      withEmail: emailCount ?? 0,
      byRegion: regionCounts,
      byDepartment: deptCounts,
    },
  });
});

// GET /:id - Hospital detail with equipments and treatments
hospitals.get('/:id', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const id = c.req.param('id');

  const { data: hospital, error } = await supabase
    .from('hospitals')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !hospital) {
    return c.json(
      {
        success: false,
        error: { code: 'HOSPITAL_NOT_FOUND', message: '해당 병원을 찾을 수 없습니다.' },
      },
      404
    );
  }

  const { data: equipments } = await supabase
    .from('hospital_equipments')
    .select('id, equipment_name, equipment_brand, equipment_category, equipment_model, estimated_year, is_confirmed, source')
    .eq('hospital_id', id)
    .order('created_at', { ascending: false });

  const { data: treatments } = await supabase
    .from('hospital_treatments')
    .select('id, treatment_name, treatment_category, price_min, price_max, is_promoted, source')
    .eq('hospital_id', id)
    .order('created_at', { ascending: false });

  return c.json({
    success: true,
    data: {
      ...hospital,
      equipments: equipments ?? [],
      treatments: treatments ?? [],
    },
  });
});

// PUT /:id - Update hospital
hospitals.put('/:id', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const id = c.req.param('id');

  const body: unknown = await c.req.json();
  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const allowedFields = [
    'name', 'address', 'address_detail', 'sido', 'sigungu', 'dong',
    'phone', 'email', 'website', 'doctor_name', 'doctor_specialty',
    'doctor_board', 'department', 'hospital_type', 'status', 'is_target',
    'exclude_reason', 'verified_at',
  ];

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (allowedFields.includes(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json(
      { success: false, error: { code: 'NO_UPDATES', message: '업데이트할 필드가 없습니다.' } },
      400
    );
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('hospitals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  return c.json({ success: true, data });
});

// POST /search - Search hospitals
hospitals.post('/search', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const body: unknown = await c.req.json();
  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const { query, limit: rawLimit } = body as { query?: string; limit?: number };

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return c.json(
      { success: false, error: { code: 'MISSING_QUERY', message: '검색어를 입력하세요.' } },
      400
    );
  }

  const searchLimit = Math.min(rawLimit ?? 20, 100);

  const { data, error } = await supabase
    .from('hospitals')
    .select('id, name, address, sido, sigungu, department, email, data_quality_score, status')
    .or(`name.ilike.%${query}%,address.ilike.%${query}%`)
    .eq('status', 'active')
    .limit(searchLimit);

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  return c.json({ success: true, data: data ?? [] });
});

export default hospitals;
