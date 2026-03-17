import { createSupabaseClient } from '../../lib/supabase';
import type { Demo, DemoEvaluation } from '@madmedsales/shared';
import { T } from '../../lib/table-names';
import { buildDemoPrepPrompt } from '../ai/prompts/demo-prep.js';
import { logAiUsage } from '../ai/usage-logger';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY?: string;
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
    .from(T.demos)
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

interface CreateDemoInput {
  lead_id: string;
  hospital_id?: string;
  product_id?: string;
  demo_type: string;
  scheduled_at?: string;
  assigned_to?: string;
  notes?: string;
}

export async function createDemo(
  env: Bindings,
  input: CreateDemoInput
): Promise<Demo> {
  const supabase = createSupabaseClient(env);

  // lead 존재 확인 + hospital_id/product_id 자동 채움
  const { data: lead, error: leadErr } = await supabase
    .from(T.leads)
    .select('id, hospital_id, product_id')
    .eq('id', input.lead_id)
    .single();

  if (leadErr || !lead) {
    throw new Error('LEAD_NOT_FOUND');
  }

  const { data, error } = await supabase
    .from(T.demos)
    .insert({
      lead_id: input.lead_id,
      hospital_id: input.hospital_id ?? lead.hospital_id,
      product_id: input.product_id ?? lead.product_id,
      demo_type: input.demo_type,
      status: 'requested',
      scheduled_at: input.scheduled_at ?? null,
      assigned_to: input.assigned_to ?? null,
      notes: input.notes ?? null,
      requested_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create demo');
  }

  // 리드 stage를 demo_scheduled로 업데이트
  await supabase
    .from(T.leads)
    .update({ stage: 'demo_scheduled', updated_at: new Date().toISOString() })
    .eq('id', input.lead_id);

  await logDemoActivity(supabase, input.lead_id, data.id, 'demo_requested', '데모 요청 생성');

  return data as Demo;
}

export async function getDemoById(
  env: Bindings,
  id: string
): Promise<{ demo: Demo; evaluation: DemoEvaluation | null }> {
  const supabase = createSupabaseClient(env);

  const { data: demo, error: demoErr } = await supabase
    .from(T.demos)
    .select('*')
    .eq('id', id)
    .single();

  if (demoErr || !demo) {
    throw new Error('DEMO_NOT_FOUND');
  }

  const { data: evaluation } = await supabase
    .from(T.demo_evaluations)
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
    .from(T.demos)
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

interface DemoPrepResult {
  prep_summary: string;
  roi_simulation: {
    monthly_revenue_increase: string;
    payback_period: string;
    assumptions: string[];
  };
  selling_points: string[];
  objection_handling: { objection: string; response: string }[];
  recommended_demo_flow: string[];
}

export async function prepareDemoMaterials(
  env: Bindings,
  id: string
): Promise<Demo> {
  const supabase = createSupabaseClient(env);

  const { data: demo, error: fetchErr } = await supabase
    .from(T.demos)
    .select('*, leads!inner(hospital_id, product_id)')
    .eq('id', id)
    .single();

  if (fetchErr || !demo) {
    throw new Error('DEMO_NOT_FOUND');
  }

  const leadData = demo.leads as { hospital_id: string; product_id?: string } | undefined;
  const hospitalId = leadData?.hospital_id;
  const productId = leadData?.product_id;

  // 병원, 제품, 프로파일, 매칭 데이터 병렬 조회
  const [hospitalRes, productRes, profileRes, matchRes, equipRes, treatRes, emailRes, emailEventsRes] = await Promise.all([
    hospitalId ? supabase.from(T.hospitals).select('name, address, department').eq('id', hospitalId).single() : null,
    productId ? supabase.from(T.products).select('name, description, price_range, demo_guide').eq('id', productId).single() : null,
    hospitalId ? supabase.from(T.hospital_profiles).select('investment_score, portfolio_diversity_score, practice_scale_score, profile_score, profile_grade').eq('hospital_id', hospitalId).single() : null,
    hospitalId && productId ? supabase.from(T.product_match_scores).select('total_score, grade, top_pitch_points').eq('hospital_id', hospitalId).eq('product_id', productId).single() : null,
    hospitalId ? supabase.from(T.hospital_equipments).select('equipment_name, equipment_category').eq('hospital_id', hospitalId) : null,
    hospitalId ? supabase.from(T.hospital_treatments).select('treatment_name, treatment_category, price_min').eq('hospital_id', hospitalId) : null,
    supabase.from(T.emails).select('subject, status, sent_at').eq('lead_id', demo.lead_id).order('sent_at', { ascending: false }).limit(5),
    supabase.from(T.email_events).select('event_type, clicked_url, created_at').eq('lead_id', demo.lead_id).in('event_type', ['opened', 'clicked']).order('created_at', { ascending: false }).limit(20),
  ]);

  const hospital = hospitalRes?.data;
  const product = productRes?.data;
  const profile = profileRes?.data;
  const match = matchRes?.data;
  const equips = equipRes?.data ?? [];
  const treats = treatRes?.data ?? [];
  const emails = emailRes?.data ?? [];
  const emailEvents = emailEventsRes?.data ?? [];

  let prepResult: DemoPrepResult | null = null;

  // AI 생성 시도
  if (env.ANTHROPIC_API_KEY && hospital && product) {
    try {
      const template = buildDemoPrepPrompt(
        product.name ?? '',
        product.description ?? '',
        product.price_range ?? '미정'
      );

      const equipList = equips.length > 0
        ? equips.map((e) => `- ${e.equipment_name} (${e.equipment_category})`).join('\n')
        : '- 장비 정보 없음';
      const treatList = treats.length > 0
        ? treats.map((t) => `- ${t.treatment_name} (${t.treatment_category ?? '미분류'}${t.price_min ? ', ' + t.price_min.toLocaleString() + '원~' : ''})`).join('\n')
        : '- 시술 정보 없음';
      const emailHistory = emails.length > 0
        ? emails.map((e) => `- ${e.subject} (${e.status}, ${e.sent_at ?? '미발송'})`).join('\n')
        : '- 이메일 이력 없음';

      // interest_signals: 이메일 오픈/클릭 집계
      const openCount = emailEvents.filter((ev) => ev.event_type === 'opened').length;
      const clickCount = emailEvents.filter((ev) => ev.event_type === 'clicked').length;
      const clickedUrls = [...new Set(
        emailEvents
          .filter((ev) => ev.event_type === 'clicked' && ev.clicked_url)
          .map((ev) => ev.clicked_url as string)
      )];
      const interestSignals = openCount > 0 || clickCount > 0
        ? [
            `- 이메일 오픈: ${openCount}회`,
            `- 링크 클릭: ${clickCount}회`,
            clickedUrls.length > 0 ? `- 방문 페이지: ${clickedUrls.slice(0, 3).join(', ')}` : null,
          ].filter(Boolean).join('\n')
        : '- 이메일 반응 없음 (오픈/클릭 이력 없음)';

      const prompt = template
        .replace('{{hospital_name}}', hospital.name ?? '')
        .replace('{{address}}', hospital.address ?? '정보 없음')
        .replace('{{department}}', hospital.department ?? '정보 없음')
        .replace('{{investment_score}}', String(profile?.investment_score ?? 0))
        .replace('{{portfolio_score}}', String(profile?.portfolio_diversity_score ?? 0))
        .replace('{{scale_trust_score}}', String(profile?.practice_scale_score ?? 0))
        .replace('{{profile_grade}}', (profile?.profile_grade as string) ?? 'N/A')
        .replace('{{match_total_score}}', String(match?.total_score ?? 0))
        .replace('{{match_grade}}', (match?.grade as string) ?? 'N/A')
        .replace('{{top_pitch_points}}', ((match?.top_pitch_points as string[]) ?? []).join(', ') || '없음')
        .replace('{{interest_signals}}', interestSignals)
        .replace('{{equipments_list}}', equipList)
        .replace('{{treatments_list}}', treatList)
        .replace('{{email_history}}', emailHistory);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 800,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (response.ok) {
        const result = await response.json() as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };

        if (result.usage) {
          await logAiUsage(supabase, {
            service: 'claude',
            model: 'claude-haiku-4-5',
            purpose: 'demo_prep',
            inputTokens: result.usage.input_tokens ?? 0,
            outputTokens: result.usage.output_tokens ?? 0,
          });
        }

        const textBlock = result.content.find((b) => b.type === 'text');
        if (textBlock?.text) {
          prepResult = JSON.parse(textBlock.text) as DemoPrepResult;
        }
      }
    } catch {
      // AI 실패 시 fallback
    }
  }

  // Fallback
  const prepSummary = prepResult?.prep_summary ?? `${hospital?.name ?? '병원'} 맞춤 데모 준비 중. 프로파일 등급 ${(profile?.profile_grade as string) ?? 'N/A'}, 매칭 등급 ${(match?.grade as string) ?? 'N/A'}.`;
  const prepRoi = prepResult?.roi_simulation
    ? { estimated_monthly_revenue: parseInt(prepResult.roi_simulation.monthly_revenue_increase.replace(/\D/g, ''), 10) || 5000000, payback_months: parseInt(prepResult.roi_simulation.payback_period, 10) || 8 }
    : { estimated_monthly_revenue: 5000000, payback_months: 8 };
  const prepCombo = product?.demo_guide ?? prepResult?.selling_points?.join(', ') ?? '제품별 맞춤 시술 제안';

  // 반론 대응 + 데모 플로우를 notes에 포함
  const aiNotes = prepResult
    ? [
        '## 반론 대응',
        ...prepResult.objection_handling.map((o) => `- Q: ${o.objection}\n  A: ${o.response}`),
        '',
        '## 추천 데모 순서',
        ...prepResult.recommended_demo_flow.map((s, i) => `${i + 1}. ${s}`),
      ].join('\n')
    : null;

  const { data, error } = await supabase
    .from(T.demos)
    .update({
      status: 'preparing',
      prep_summary: prepSummary,
      prep_roi_simulation: prepRoi,
      prep_product_pitch: prepCombo,
      notes: aiNotes,
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
    .from(T.demos)
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
    .from(T.demos)
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

interface EvaluationInput {
  satisfaction_score: number;
  purchase_intent: string;
  preferred_payment?: string;
  additional_questions?: string;
  feedback?: string;
}

export async function submitDemoEvaluation(
  env: Bindings,
  demoId: string,
  input: EvaluationInput
): Promise<{ evaluation: DemoEvaluation; followUpCreated: boolean }> {
  const supabase = createSupabaseClient(env);

  const { data: demo, error: demoErr } = await supabase
    .from(T.demos)
    .select('id, lead_id, hospital_id, product_id, status')
    .eq('id', demoId)
    .single();

  if (demoErr || !demo) {
    throw new Error('DEMO_NOT_FOUND');
  }

  // 평가 upsert (demo_id 기준)
  const { data: evaluation, error: evalErr } = await supabase
    .from(T.demo_evaluations)
    .upsert({
      demo_id: demoId,
      lead_id: demo.lead_id,
      satisfaction_score: input.satisfaction_score,
      purchase_intent: input.purchase_intent,
      preferred_payment: input.preferred_payment ?? null,
      additional_questions: input.additional_questions ?? null,
      feedback: input.feedback ?? null,
      evaluated_at: new Date().toISOString(),
    }, { onConflict: 'demo_id' })
    .select('*')
    .single();

  if (evalErr || !evaluation) {
    throw new Error(evalErr?.message ?? 'Failed to submit evaluation');
  }

  // 데모 상태를 evaluated로 변경
  await supabase
    .from(T.demos)
    .update({ status: 'evaluated', updated_at: new Date().toISOString() })
    .eq('id', demoId);

  await logDemoActivity(supabase, demo.lead_id, demoId, 'demo_evaluated', '데모 평가 완료');

  // purchase_intent에 따른 리드 stage 자동 업데이트 + 후속 데모 생성
  let followUpCreated = false;
  const intentStageMap: Record<string, string> = {
    immediate: 'proposal',
    considering: 'negotiation',
    hold: 'nurturing',
    no_interest: 'closed_lost',
  };

  const newStage = intentStageMap[input.purchase_intent];
  if (newStage) {
    await supabase
      .from(T.leads)
      .update({ stage: newStage, interest_level: input.purchase_intent === 'immediate' ? 'hot' : undefined, updated_at: new Date().toISOString() })
      .eq('id', demo.lead_id);

    await logDemoActivity(supabase, demo.lead_id, demoId, 'stage_changed', `구매 의향(${input.purchase_intent}) → ${newStage}`);
  }

  // considering인 경우 후속 데모 자동 생성 (2주 후)
  if (input.purchase_intent === 'considering') {
    const followUpDate = new Date();
    followUpDate.setDate(followUpDate.getDate() + 14);

    const { error: followUpErr } = await supabase.from(T.demos).insert({
      lead_id: demo.lead_id,
      hospital_id: demo.hospital_id ?? null,
      product_id: demo.product_id ?? null,
      demo_type: 'visit',
      status: 'requested',
      scheduled_at: followUpDate.toISOString(),
      notes: `이전 데모(${demoId.slice(0, 8)}) 후속 - 검토중 고객`,
      requested_at: new Date().toISOString(),
    });

    if (!followUpErr) {
      followUpCreated = true;
      await logDemoActivity(supabase, demo.lead_id, demoId, 'follow_up_scheduled', '후속 데모 자동 예약 (2주 후)');
    }
  }

  return { evaluation: evaluation as DemoEvaluation, followUpCreated };
}

async function logDemoActivity(
  supabase: ReturnType<typeof createSupabaseClient>,
  leadId: string,
  demoId: string,
  activityType: string,
  title: string
): Promise<void> {
  await supabase.from(T.lead_activities).insert({
    lead_id: leadId,
    activity_type: activityType,
    title,
    metadata: { demo_id: demoId },
    actor: 'system',
  });
}
