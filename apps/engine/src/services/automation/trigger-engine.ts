// v1.0 - 2026-02-20
// Trigger engine: evaluates rules and fires actions based on lead state

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../../lib/supabase';
import { calculateInterestLevel } from '../interest-calculator';
import { executeAction, type TriggerAction } from './action-executor';

export interface TriggerCondition {
  field: string;
  operator: 'eq' | 'gte' | 'lte' | 'gt' | 'lt' | 'in' | 'not_null' | 'is_true';
  value: unknown;
}

export interface TriggerRule {
  id: string;
  name: string;
  conditions: TriggerCondition[];
  actions: TriggerAction[];
  cooldownMinutes: number;
  enabled: boolean;
}

export const DEFAULT_TRIGGER_RULES: TriggerRule[] = [
  {
    id: 'email_opened_followup',
    name: '이메일 열람 후 후속 이메일',
    conditions: [
      { field: 'open_count', operator: 'gte', value: 1 },
      { field: 'click_count', operator: 'eq', value: 0 },
      { field: 'interest_level', operator: 'eq', value: 'warming' },
    ],
    actions: [
      { type: 'update_interest', params: { level: 'warming' } },
      { type: 'send_email', params: { trigger: 'email_opened' } },
    ],
    cooldownMinutes: 1440, // 24 hours
    enabled: true,
  },
  {
    id: 'link_clicked_upgrade',
    name: '링크 클릭 시 관심도 상향',
    conditions: [
      { field: 'click_count', operator: 'gte', value: 1 },
    ],
    actions: [
      { type: 'update_interest', params: { level: 'warm' } },
      { type: 'send_email', params: { trigger: 'link_clicked' } },
    ],
    cooldownMinutes: 1440,
    enabled: true,
  },
  {
    id: 'demo_page_hot',
    name: '데모 페이지 2회 이상 방문 시 핫 리드',
    conditions: [
      { field: 'demo_page_visits', operator: 'gte', value: 2 },
    ],
    actions: [
      { type: 'update_interest', params: { level: 'hot' } },
      { type: 'notify_admin', params: { reason: '데모 페이지 반복 방문' } },
      { type: 'send_email', params: { trigger: 'demo_page_visited' } },
    ],
    cooldownMinutes: 2880, // 48 hours
    enabled: true,
  },
  {
    id: 'price_page_warm',
    name: '가격 페이지 방문 시 워밍',
    conditions: [
      { field: 'price_page_visits', operator: 'gte', value: 1 },
    ],
    actions: [
      { type: 'update_interest', params: { level: 'warm' } },
      { type: 'send_email', params: { trigger: 'price_page_visited' } },
    ],
    cooldownMinutes: 1440,
    enabled: true,
  },
  {
    id: 'reply_received',
    name: '회신 수신 시 처리',
    conditions: [
      { field: 'reply_count', operator: 'gte', value: 1 },
    ],
    actions: [
      { type: 'update_interest', params: { level: 'warm' } },
      { type: 'notify_admin', params: { reason: '원장님 회신 수신' } },
    ],
    cooldownMinutes: 60,
    enabled: true,
  },
  {
    id: 'no_response_reapproach',
    name: '7일 무응답 시 재접근',
    conditions: [
      { field: 'stage', operator: 'eq', value: 'contacted' },
      { field: 'days_since_last_email', operator: 'gte', value: 7 },
      { field: 'open_count', operator: 'eq', value: 0 },
    ],
    actions: [
      { type: 'send_email', params: { trigger: 'no_response' } },
    ],
    cooldownMinutes: 10080, // 7 days
    enabled: true,
  },
  {
    id: 'positive_reply_kakao',
    name: '긍정 회신 시 카카오 연결',
    conditions: [
      { field: 'last_reply_sentiment', operator: 'eq', value: 'positive' },
    ],
    actions: [
      { type: 'update_interest', params: { level: 'hot' } },
      { type: 'kakao_connect', params: {} },
      { type: 'notify_admin', params: { reason: '긍정 회신 - 카카오 연결 추천' } },
    ],
    cooldownMinutes: 1440,
    enabled: true,
  },
  {
    id: 'bounced_pause',
    name: '바운스 시 시퀀스 일시 중지',
    conditions: [
      { field: 'last_email_bounced', operator: 'is_true', value: true },
    ],
    actions: [
      { type: 'pause_sequence', params: {} },
    ],
    cooldownMinutes: 43200, // 30 days
    enabled: true,
  },
];

interface LeadRow {
  id: string;
  hospital_id: string;
  stage: string;
  grade: string | null;
  interest_level: string;
  open_count: number;
  click_count: number;
  reply_count: number;
  demo_page_visits: number;
  price_page_visits: number;
  last_email_sent_at: string | null;
  contact_email: string | null;
  kakao_connected: boolean;
}

function evaluateCondition(
  lead: LeadRow & { days_since_last_email: number; last_reply_sentiment: string | null; last_email_bounced: boolean },
  condition: TriggerCondition
): boolean {
  const fieldValue = lead[condition.field as keyof typeof lead];

  switch (condition.operator) {
    case 'eq':
      return fieldValue === condition.value;
    case 'gte':
      return typeof fieldValue === 'number' && fieldValue >= (condition.value as number);
    case 'lte':
      return typeof fieldValue === 'number' && fieldValue <= (condition.value as number);
    case 'gt':
      return typeof fieldValue === 'number' && fieldValue > (condition.value as number);
    case 'lt':
      return typeof fieldValue === 'number' && fieldValue < (condition.value as number);
    case 'in':
      return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case 'not_null':
      return fieldValue !== null && fieldValue !== undefined;
    case 'is_true':
      return fieldValue === true;
    default:
      return false;
  }
}

async function checkCooldown(
  supabase: SupabaseClient,
  leadId: string,
  ruleId: string,
  cooldownMinutes: number
): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownMinutes * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('lead_activities')
    .select('id')
    .eq('lead_id', leadId)
    .eq('metadata->>trigger_rule_id', ruleId)
    .gte('created_at', cutoff)
    .limit(1);

  if (error) return true; // If error, assume cooldown active (safe)
  return (data?.length ?? 0) > 0;
}

export async function evaluateTriggers(
  supabase: SupabaseClient,
  leadRow: LeadRow
): Promise<TriggerAction[]> {
  const daysSinceLastEmail = leadRow.last_email_sent_at
    ? Math.floor((Date.now() - new Date(leadRow.last_email_sent_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  // Fetch latest reply sentiment
  const { data: latestReply } = await supabase
    .from('lead_activities')
    .select('metadata')
    .eq('lead_id', leadRow.id)
    .eq('activity_type', 'email_replied')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastReplySentiment = (latestReply?.[0]?.metadata as Record<string, unknown> | null)?.['sentiment'] as string | null ?? null;

  // Check if last email bounced
  const { data: lastBounce } = await supabase
    .from('email_events')
    .select('id')
    .eq('lead_id', leadRow.id)
    .eq('event_type', 'bounced')
    .order('created_at', { ascending: false })
    .limit(1);

  const enrichedLead = {
    ...leadRow,
    days_since_last_email: daysSinceLastEmail,
    last_reply_sentiment: lastReplySentiment,
    last_email_bounced: (lastBounce?.length ?? 0) > 0,
  };

  const actions: TriggerAction[] = [];

  for (const rule of DEFAULT_TRIGGER_RULES) {
    if (!rule.enabled) continue;

    const allMatch = rule.conditions.every((cond) =>
      evaluateCondition(enrichedLead, cond)
    );

    if (!allMatch) continue;

    const onCooldown = await checkCooldown(
      supabase,
      leadRow.id,
      rule.id,
      rule.cooldownMinutes
    );

    if (onCooldown) continue;

    for (const action of rule.actions) {
      actions.push({ ...action, ruleId: rule.id });
    }
  }

  return actions;
}

interface TriggerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  WEB_URL: string;
  KAKAO_API_KEY: string;
  KAKAO_SENDER_KEY: string;
}

export async function processAllTriggers(
  env: TriggerEnv
): Promise<{ processed: number; actionsExecuted: number }> {
  const supabase = createSupabaseClient(env);

  const { data: leads, error } = await supabase
    .from('leads')
    .select('id, hospital_id, stage, grade, interest_level, open_count, click_count, reply_count, demo_page_visits, price_page_visits, last_email_sent_at, contact_email, kakao_connected')
    .not('stage', 'in', '("closed_won","closed_lost")')
    .not('contact_email', 'is', null);

  if (error) {
    throw new Error(`Failed to fetch leads: ${error.message}`);
  }

  let processed = 0;
  let actionsExecuted = 0;

  for (const lead of leads ?? []) {
    const actions = await evaluateTriggers(supabase, lead as LeadRow);
    processed++;

    for (const action of actions) {
      try {
        await executeAction(env, supabase, lead as LeadRow, action);
        actionsExecuted++;
      } catch (actionError) {
        const msg = actionError instanceof Error ? actionError.message : 'Unknown';
        await supabase.from('lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'ai_analysis',
          title: '트리거 액션 실행 실패',
          description: `Rule: ${action.ruleId ?? 'unknown'}, Error: ${msg}`,
          actor: 'system',
        });
      }
    }
  }

  // Update interest levels based on current engagement
  for (const lead of leads ?? []) {
    const typedLead = lead as LeadRow;
    const newLevel = calculateInterestLevel({
      replyCount: typedLead.reply_count,
      clickCount: typedLead.click_count,
      openCount: typedLead.open_count,
      demoPageVisits: typedLead.demo_page_visits,
      pricePageVisits: typedLead.price_page_visits,
      lastReplySentiment: null,
    });

    if (newLevel !== typedLead.interest_level) {
      await supabase
        .from('leads')
        .update({ interest_level: newLevel })
        .eq('id', typedLead.id);
    }
  }

  return { processed, actionsExecuted };
}
