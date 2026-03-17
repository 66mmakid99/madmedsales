// v2.0 - 2026-03-16
// Trigger engine: evaluates rules and fires actions based on lead state
// Changes: product-type differentiated triggers, 3mo/6mo re-approach,
//          permanent exclusion after 3rd re-approach, negative reply trigger

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../../lib/supabase';
import { calculateInterestLevel } from '../interest-calculator';
import { executeAction, type TriggerAction } from './action-executor';
import { T } from '../../lib/table-names';
import {
  DEFAULT_TRIGGER_RULES,
  buildProductTypeTriggerRules,
  getProductTriggerThresholds,
  type TriggerCondition,
  type TriggerRule,
} from './trigger-rules';

export type { TriggerCondition, TriggerRule };
export { DEFAULT_TRIGGER_RULES, getProductTriggerThresholds };

interface LeadRow {
  id: string;
  hospital_id: string;
  product_id?: string;
  stage: string;
  grade: string | null;
  interest_level: string;
  open_count: number;
  click_count: number;
  reply_count: number;
  demo_page_visits: number;
  price_page_visits: number;
  product_page_visits: number;
  last_email_sent_at: string | null;
  contact_email: string | null;
  kakao_connected: boolean;
}

type EnrichedLead = LeadRow & {
  days_since_last_email: number;
  last_reply_sentiment: string | null;
  last_email_bounced: boolean;
  last_email_complained: boolean;
  reapproach_count: number;
};

function evaluateCondition(lead: EnrichedLead, condition: TriggerCondition): boolean {
  const fieldValue = lead[condition.field as keyof typeof lead];

  switch (condition.operator) {
    case 'eq':    return fieldValue === condition.value;
    case 'gte':   return typeof fieldValue === 'number' && fieldValue >= (condition.value as number);
    case 'lte':   return typeof fieldValue === 'number' && fieldValue <= (condition.value as number);
    case 'gt':    return typeof fieldValue === 'number' && fieldValue > (condition.value as number);
    case 'lt':    return typeof fieldValue === 'number' && fieldValue < (condition.value as number);
    case 'in':    return Array.isArray(condition.value) && condition.value.includes(fieldValue);
    case 'not_null': return fieldValue !== null && fieldValue !== undefined;
    case 'is_true':  return fieldValue === true;
    default:      return false;
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
    .from(T.lead_activities)
    .select('id')
    .eq('lead_id', leadId)
    .eq('metadata->>trigger_rule_id', ruleId)
    .gte('created_at', cutoff)
    .limit(1);

  if (error) return true;
  return (data?.length ?? 0) > 0;
}

async function getReapproachCount(supabase: SupabaseClient, leadId: string): Promise<number> {
  const { data, error } = await supabase
    .from(T.lead_activities)
    .select('id')
    .eq('lead_id', leadId)
    .eq('activity_type', 'note_added')
    .ilike('title', '재접근 예정%');

  if (error) return 0;
  return data?.length ?? 0;
}

async function enrichLead(supabase: SupabaseClient, leadRow: LeadRow): Promise<EnrichedLead> {
  const daysSinceLastEmail = leadRow.last_email_sent_at
    ? Math.floor((Date.now() - new Date(leadRow.last_email_sent_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  const { data: latestReply } = await supabase
    .from(T.lead_activities)
    .select('metadata')
    .eq('lead_id', leadRow.id)
    .eq('activity_type', 'email_replied')
    .order('created_at', { ascending: false })
    .limit(1);

  const lastReplySentiment =
    (latestReply?.[0]?.metadata as Record<string, unknown> | null)?.['sentiment'] as string | null ?? null;

  const { data: lastBounce } = await supabase
    .from(T.email_events)
    .select('id')
    .eq('lead_id', leadRow.id)
    .eq('event_type', 'bounced')
    .order('created_at', { ascending: false })
    .limit(1);

  const { data: lastComplaint } = await supabase
    .from(T.email_events)
    .select('id')
    .eq('lead_id', leadRow.id)
    .eq('event_type', 'complained')
    .order('created_at', { ascending: false })
    .limit(1);

  const reapproachCount = await getReapproachCount(supabase, leadRow.id);

  return {
    ...leadRow,
    days_since_last_email: daysSinceLastEmail,
    last_reply_sentiment: lastReplySentiment,
    last_email_bounced: (lastBounce?.length ?? 0) > 0,
    last_email_complained: (lastComplaint?.length ?? 0) > 0,
    reapproach_count: reapproachCount,
  };
}

export async function evaluateTriggers(
  supabase: SupabaseClient,
  leadRow: LeadRow,
  productCategory?: string
): Promise<TriggerAction[]> {
  const enriched = await enrichLead(supabase, leadRow);

  // 3회 재접근 후 영구 제외
  if (enriched.reapproach_count >= 3) {
    await supabase
      .from(T.leads)
      .update({ stage: 'closed_lost', admin_notes: '3회 재접근 후 영구 제외' })
      .eq('id', leadRow.id);
    await supabase.from(T.lead_activities).insert({
      lead_id: leadRow.id,
      activity_type: 'stage_changed',
      title: '영구 제외: 3회 재접근 후 무반응',
      actor: 'system',
    });
    return [];
  }

  const thresholds = getProductTriggerThresholds(productCategory ?? 'service');
  const allRules = [...buildProductTypeTriggerRules(thresholds), ...DEFAULT_TRIGGER_RULES];
  const actions: TriggerAction[] = [];

  for (const rule of allRules) {
    if (!rule.enabled) continue;
    const allMatch = rule.conditions.every((cond) => evaluateCondition(enriched, cond));
    if (!allMatch) continue;
    const onCooldown = await checkCooldown(supabase, leadRow.id, rule.id, rule.cooldownMinutes);
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
): Promise<{ processed: number; actionsExecuted: number; errors: number }> {
  const supabase = createSupabaseClient(env);

  const { data: leads, error } = await supabase
    .from(T.leads)
    .select(`
      id, hospital_id, product_id, stage, grade, interest_level,
      open_count, click_count, reply_count, demo_page_visits,
      price_page_visits, product_page_visits, last_email_sent_at,
      contact_email, kakao_connected,
      products!inner(category)
    `)
    .not('stage', 'in', '("closed_won","closed_lost")')
    .not('contact_email', 'is', null);

  if (error) throw new Error(`Failed to fetch leads: ${error.message}`);

  let processed = 0;
  let actionsExecuted = 0;
  let errors = 0;
  const CHUNK_SIZE = 10;

  type LeadWithProduct = LeadRow & { products?: { category?: string } | null };
  const allLeads = (leads ?? []) as LeadWithProduct[];

  for (let i = 0; i < allLeads.length; i += CHUNK_SIZE) {
    const chunk = allLeads.slice(i, i + CHUNK_SIZE);

    const triggerResults = await Promise.allSettled(
      chunk.map((lead) => evaluateTriggers(supabase, lead, lead.products?.category ?? undefined))
    );

    const actionPromises = chunk.map(async (lead, idx) => {
      processed++;
      const result = triggerResults[idx];
      if (result.status !== 'fulfilled') return;

      for (const action of result.value) {
        try {
          await executeAction(env, supabase, lead, action);
          actionsExecuted++;
        } catch (actionError) {
          errors++;
          const msg = actionError instanceof Error ? actionError.message : 'Unknown';
          await supabase.from(T.lead_activities).insert({
            lead_id: lead.id,
            activity_type: 'ai_analysis',
            title: '트리거 액션 실행 실패',
            description: `Rule: ${action.ruleId ?? 'unknown'}, Type: ${action.type}, Error: ${msg}`,
            actor: 'system',
          });
        }
      }
    });

    await Promise.allSettled(actionPromises);
  }

  // 관심도 레벨 일괄 업데이트
  for (let i = 0; i < allLeads.length; i += CHUNK_SIZE) {
    const chunk = allLeads.slice(i, i + CHUNK_SIZE);
    await Promise.allSettled(
      chunk.map(async (lead) => {
        const newLevel = calculateInterestLevel({
          replyCount: lead.reply_count,
          clickCount: lead.click_count,
          openCount: lead.open_count,
          demoPageVisits: lead.demo_page_visits,
          pricePageVisits: lead.price_page_visits,
          productPageVisits: lead.product_page_visits,
          lastReplySentiment: null,
          lastActivityAt: lead.last_email_sent_at,
        });

        if (newLevel !== lead.interest_level) {
          await supabase.from(T.leads).update({ interest_level: newLevel }).eq('id', lead.id);
        }
      })
    );
  }

  return { processed, actionsExecuted, errors };
}
