import { Hono } from 'hono';
import { createSupabaseClient } from '../../lib/supabase.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const products = new Hono<{ Bindings: Bindings }>();

// ===== GET / — 제품 목록 =====
products.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const tenantId = c.req.query('tenant_id');

  let query = supabase
    .from('crm_products')
    .select('*')
    .order('created_at', { ascending: true });

  if (tenantId) query = query.eq('tenant_id', tenantId);

  const { data, error } = await query;
  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data: data ?? [] });
});

// ===== GET /:id — 제품 상세 =====
products.get('/:id', async (c) => {
  const id = c.req.param('id');
  const supabase = createSupabaseClient(c.env);

  const { data, error } = await supabase
    .from('crm_products')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: '제품을 찾을 수 없습니다.' } }, 404);
  }

  return c.json({ success: true, data });
});

// ===== POST / — 제품 등록 =====
products.post('/', async (c) => {
  const body = await c.req.json<{
    tenant_id: string;
    name: string;
    model_variants?: string[];
    price_range?: string;
    warranty_months?: number;
    consumables?: unknown[];
  }>();

  if (!body.tenant_id || !body.name?.trim()) {
    return c.json({ success: false, error: { code: 'VALIDATION', message: 'tenant_id와 name은 필수입니다.' } }, 400);
  }

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_products')
    .insert({
      tenant_id: body.tenant_id,
      name: body.name.trim(),
      model_variants: body.model_variants ?? null,
      price_range: body.price_range ?? null,
      warranty_months: body.warranty_months ?? 24,
      consumables: body.consumables ?? null,
    })
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data }, 201);
});

// ===== PATCH /:id — 제품 수정 =====
products.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const supabase = createSupabaseClient(c.env);
  const { data, error } = await supabase
    .from('crm_products')
    .update(body)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json({ success: false, error: { code: 'DB_ERROR', message: error.message } }, 500);
  }

  return c.json({ success: true, data });
});

export default products;
