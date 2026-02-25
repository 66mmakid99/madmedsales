import { Hono } from 'hono';
import { createSupabaseClient } from '../../lib/supabase.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const contacts = new Hono<{ Bindings: Bindings }>();

// ===== GET / — 담당자 목록 =====
contacts.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const hospitalId = c.req.query('hospital_id');
  const tenantId = c.req.query('tenant_id');

  let query = supabase
    .from('crm_contacts')
    .select('*')
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (hospitalId) query = query.eq('hospital_id', hospitalId);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data: data ?? [] });
});

// ===== POST / — 담당자 추가 =====
contacts.post('/', async (c) => {
  const body = await c.req.json<{
    hospital_id: string;
    tenant_id: string;
    name: string;
    role?: string;
    is_primary?: boolean;
    phone?: string;
    email?: string;
    kakao_id?: string;
    interests?: string[];
    personality_notes?: string;
    preferred_contact?: string;
    birthday?: string;
  }>();

  if (!body.hospital_id || !body.tenant_id || !body.name?.trim()) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'hospital_id, tenant_id, name은 필수입니다.' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_contacts')
    .insert({
      hospital_id: body.hospital_id,
      tenant_id: body.tenant_id,
      name: body.name.trim(),
      role: body.role ?? null,
      is_primary: body.is_primary ?? false,
      phone: body.phone ?? null,
      email: body.email ?? null,
      kakao_id: body.kakao_id ?? null,
      interests: body.interests ?? null,
      personality_notes: body.personality_notes ?? null,
      preferred_contact: body.preferred_contact ?? 'kakao',
      birthday: body.birthday ?? null,
    })
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data }, 201);
});

// ===== PATCH /:id — 담당자 수정 =====
contacts.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_contacts')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

// ===== DELETE /:id — 담당자 삭제 =====
contacts.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const { error } = await supabase.from('crm_contacts').delete().eq('id', id);
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true });
});

export default contacts;
