// v1.0 - 2026-02-20
// Action executor: handles trigger actions for leads

import type { SupabaseClient } from '@supabase/supabase-js';

export interface TriggerAction {
  type:
    | 'send_email'
    | 'update_interest'
    | 'update_stage'
    | 'kakao_connect'
    | 'notify_admin'
    | 'schedule_reapproach'
    | 'pause_sequence';
  params: Record<string, unknown>;
  ruleId?: string;
}

interface LeadRef {
  id: string;
  hospital_id: string;
  contact_email: string | null;
  grade: string | null;
}

interface ActionEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  WEB_URL: string;
  KAKAO_API_KEY: string;
  KAKAO_SENDER_KEY: string;
}

export async function executeAction(
  env: ActionEnv,
  supabase: SupabaseClient,
  lead: LeadRef,
  action: TriggerAction
): Promise<void> {
  switch (action.type) {
    case 'send_email':
      await handleSendEmail(supabase, lead, action);
      break;
    case 'update_interest':
      await handleUpdateInterest(supabase, lead, action);
      break;
    case 'update_stage':
      await handleUpdateStage(supabase, lead, action);
      break;
    case 'kakao_connect':
      await handleKakaoConnect(supabase, lead);
      break;
    case 'notify_admin':
      await handleNotifyAdmin(supabase, lead, action);
      break;
    case 'schedule_reapproach':
      await handleScheduleReapproach(supabase, lead, action);
      break;
    case 'pause_sequence':
      await handlePauseSequence(supabase, lead);
      break;
  }

  // Log every action
  await logActionActivity(supabase, lead.id, action);
}

async function handleSendEmail(
  supabase: SupabaseClient,
  lead: LeadRef,
  action: TriggerAction
): Promise<void> {
  if (!lead.contact_email) return;

  const trigger = action.params['trigger'] as string | undefined;

  // Create a queued email record for the follow-up
  const { error } = await supabase.from('emails').insert({
    lead_id: lead.id,
    subject: `[자동] ${trigger ?? 'followup'} 트리거 이메일`,
    body_html: '<p>AI 생성 대기중</p>',
    body_text: 'AI 생성 대기중',
    from_email: 'noreply@madmedsales.com',
    to_email: lead.contact_email,
    status: 'queued',
    ai_personalization: { trigger, auto_generated: true },
  });

  if (error) {
    throw new Error(`Failed to queue trigger email: ${error.message}`);
  }
}

async function handleUpdateInterest(
  supabase: SupabaseClient,
  lead: LeadRef,
  action: TriggerAction
): Promise<void> {
  const level = action.params['level'] as string;
  if (!level) return;

  const { error } = await supabase
    .from('leads')
    .update({ interest_level: level })
    .eq('id', lead.id);

  if (error) {
    throw new Error(`Failed to update interest: ${error.message}`);
  }
}

async function handleUpdateStage(
  supabase: SupabaseClient,
  lead: LeadRef,
  action: TriggerAction
): Promise<void> {
  const stage = action.params['stage'] as string;
  if (!stage) return;

  const { error } = await supabase
    .from('leads')
    .update({ stage })
    .eq('id', lead.id);

  if (error) {
    throw new Error(`Failed to update stage: ${error.message}`);
  }

  await supabase.from('lead_activities').insert({
    lead_id: lead.id,
    activity_type: 'stage_changed',
    title: `단계 변경: ${stage}`,
    actor: 'system',
  });
}

async function handleKakaoConnect(
  supabase: SupabaseClient,
  lead: LeadRef
): Promise<void> {
  // Mark lead as needing kakao connection (admin action required)
  await supabase.from('lead_activities').insert({
    lead_id: lead.id,
    activity_type: 'note_added',
    title: '카카오톡 채널 연결 추천',
    description: '리드의 관심도가 높아 카카오톡 연결을 추천합니다.',
    actor: 'system',
  });
}

async function handleNotifyAdmin(
  supabase: SupabaseClient,
  lead: LeadRef,
  action: TriggerAction
): Promise<void> {
  const reason = action.params['reason'] as string ?? '관리자 확인 필요';

  await supabase.from('lead_activities').insert({
    lead_id: lead.id,
    activity_type: 'note_added',
    title: `[알림] ${reason}`,
    description: `Lead ID: ${lead.id}, Hospital: ${lead.hospital_id}`,
    metadata: { notification: true, reason },
    actor: 'system',
  });
}

async function handleScheduleReapproach(
  supabase: SupabaseClient,
  lead: LeadRef,
  action: TriggerAction
): Promise<void> {
  const delayDays = (action.params['delay_days'] as number) ?? 14;
  const reapproachAt = new Date(
    Date.now() + delayDays * 24 * 60 * 60 * 1000
  ).toISOString();

  await supabase.from('lead_activities').insert({
    lead_id: lead.id,
    activity_type: 'note_added',
    title: `재접근 예정: ${reapproachAt.split('T')[0]}`,
    metadata: { reapproach_at: reapproachAt, delay_days: delayDays },
    actor: 'system',
  });
}

async function handlePauseSequence(
  supabase: SupabaseClient,
  lead: LeadRef
): Promise<void> {
  await supabase
    .from('leads')
    .update({ email_sequence_id: null })
    .eq('id', lead.id);

  await supabase.from('lead_activities').insert({
    lead_id: lead.id,
    activity_type: 'note_added',
    title: '이메일 시퀀스 일시 중지',
    description: '바운스 등의 이유로 시퀀스가 중지되었습니다.',
    actor: 'system',
  });
}

async function logActionActivity(
  supabase: SupabaseClient,
  leadId: string,
  action: TriggerAction
): Promise<void> {
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'ai_analysis',
    title: `트리거 액션 실행: ${action.type}`,
    metadata: {
      trigger_rule_id: action.ruleId ?? null,
      action_type: action.type,
      action_params: action.params,
    },
    actor: 'system',
  });
}
