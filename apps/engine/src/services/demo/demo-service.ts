import { createSupabaseClient } from '../../lib/supabase';
import type { Demo, DemoEvaluation } from '@madmedsales/shared';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

interface DemoFilters {
  status?: string;
  lead_id?: string;
  date_from?: string;
  date_to?: string;
  limit?: string;
  offset?: string;
}

export async function getDemos(
  env: Bindings,
  filters: DemoFilters
): Promise<{ demos: Demo[]; total: number }> {
  const supabase = createSupabaseClient(env);
  const limit = parseInt(filters.limit || '20', 10);
  const offset = parseInt(filters.offset || '0', 10);

  let query = supabase
    .from('demos')
    .select('*', { count: 'exact' });

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.lead_id) {
    query = query.eq('lead_id', filters.lead_id);
  }
  if (filters.date_from) {
    query = query.gte('scheduled_at', filters.date_from);
  }
  if (filters.date_to) {
    query = query.lte('scheduled_at', filters.date_to);
  }

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(error.message);
  }

  return { demos: (data ?? []) as Demo[], total: count ?? 0 };
}

export async function getDemoById(
  env: Bindings,
  id: string
): Promise<{ demo: Demo; evaluation: DemoEvaluation | null }> {
  const supabase = createSupabaseClient(env);

  const { data: demo, error: demoErr } = await supabase
    .from('demos')
    .select('*')
    .eq('id', id)
    .single();

  if (demoErr || !demo) {
    throw new Error('DEMO_NOT_FOUND');
  }

  const { data: evaluation } = await supabase
    .from('demo_evaluations')
    .select('*')
    .eq('demo_id', id)
    .maybeSingle();

  return {
    demo: demo as Demo,
    evaluation: (evaluation as DemoEvaluation) ?? null,
  };
}

export async function confirmDemo(
  env: Bindings,
  id: string,
  scheduledAt: string
): Promise<Demo> {
  const supabase = createSupabaseClient(env);

  const { data, error } = await supabase
    .from('demos')
    .update({
      status: 'confirmed',
      scheduled_at: scheduledAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to confirm demo');
  }

  await logDemoActivity(supabase, data.lead_id, id, 'stage_changed', 'Demo confirmed');

  return data as Demo;
}

export async function prepareDemoMaterials(
  env: Bindings,
  id: string
): Promise<Demo> {
  const supabase = createSupabaseClient(env);

  const { data: demo, error: fetchErr } = await supabase
    .from('demos')
    .select('*, leads!inner(hospital_id)')
    .eq('id', id)
    .single();

  if (fetchErr || !demo) {
    throw new Error('DEMO_NOT_FOUND');
  }

  const prepSummary = 'AI 스코어링 요약이 곧 생성됩니다.';
  const prepRoi = { estimated_monthly_revenue: 5000000, payback_months: 8 };
  const prepCombo = 'RF + 울트라포머 콤보 시술 제안';

  const { data, error } = await supabase
    .from('demos')
    .update({
      status: 'preparing',
      prep_scoring_summary: prepSummary,
      prep_roi_simulation: prepRoi,
      prep_combo_suggestion: prepCombo,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to prepare demo');
  }

  return data as Demo;
}

export async function completeDemo(env: Bindings, id: string): Promise<Demo> {
  const supabase = createSupabaseClient(env);

  const { data, error } = await supabase
    .from('demos')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to complete demo');
  }

  await logDemoActivity(supabase, data.lead_id, id, 'demo_completed', 'Demo completed');

  return data as Demo;
}

export async function cancelDemo(
  env: Bindings,
  id: string,
  reason?: string
): Promise<Demo> {
  const supabase = createSupabaseClient(env);

  const { data, error } = await supabase
    .from('demos')
    .update({
      status: 'cancelled',
      notes: reason ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to cancel demo');
  }

  await logDemoActivity(supabase, data.lead_id, id, 'stage_changed', 'Demo cancelled');

  return data as Demo;
}

async function logDemoActivity(
  supabase: ReturnType<typeof createSupabaseClient>,
  leadId: string,
  demoId: string,
  activityType: string,
  title: string
): Promise<void> {
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: activityType,
    title,
    metadata: { demo_id: demoId },
    actor: 'system',
  });
}
