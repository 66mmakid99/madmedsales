import { Hono } from 'hono';
import { createSupabaseClient } from '../../lib/supabase.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const equipment = new Hono<{ Bindings: Bindings }>();

// ===== GET / — 장비 목록 =====
equipment.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const hospitalId = c.req.query('hospital_id');
  const tenantId = c.req.query('tenant_id');

  let query = supabase
    .from('crm_equipment')
    .select(`
      *,
      product:product_id (id, name, model_variants, warranty_months)
    `)
    .order('delivered_at', { ascending: false });

  if (hospitalId) query = query.eq('hospital_id', hospitalId);
  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data: data ?? [] });
});

// ===== POST / — 장비 등록 =====
equipment.post('/', async (c) => {
  const body = await c.req.json<{
    hospital_id: string;
    tenant_id: string;
    product_id?: string;
    serial_number?: string;
    model_variant?: string;
    delivered_at?: string;
    firmware_version?: string;
    status?: string;
    condition?: string;
  }>();

  if (!body.hospital_id || !body.tenant_id) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'hospital_id와 tenant_id는 필수입니다.' } }, 400);
  }

  // warranty_end 자동 계산
  let warrantyEnd: string | null = null;
  if (body.delivered_at && body.product_id) {
    const supabase = createSupabaseClient(c.env);
    const { data: product } = await supabase
      .from('crm_products')
      .select('warranty_months')
      .eq('id', body.product_id)
      .single();

    if (product?.warranty_months && body.delivered_at) {
      const delivered = new Date(body.delivered_at);
      delivered.setMonth(delivered.getMonth() + product.warranty_months);
      warrantyEnd = delivered.toISOString().split('T')[0];
    }
  }

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_equipment')
    .insert({
      hospital_id: body.hospital_id,
      tenant_id: body.tenant_id,
      product_id: body.product_id ?? null,
      serial_number: body.serial_number ?? null,
      model_variant: body.model_variant ?? null,
      delivered_at: body.delivered_at ?? null,
      warranty_end: warrantyEnd,
      firmware_version: body.firmware_version ?? null,
      status: body.status ?? 'active',
      condition: body.condition ?? 'new',
    })
    .select(`
      *,
      product:product_id (id, name, model_variants, warranty_months)
    `)
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data }, 201);
});

// ===== PATCH /:id — 장비 수정 =====
equipment.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_equipment')
    .update(body)
    .eq('id', id)
    .select(`
      *,
      product:product_id (id, name, model_variants, warranty_months)
    `)
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

// ===== DELETE /:id — 장비 삭제 =====
equipment.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const { error } = await supabase.from('crm_equipment').delete().eq('id', id);
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true });
});

export default equipment;
