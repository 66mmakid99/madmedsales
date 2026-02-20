// v1.0 - 2026-02-20
// DB-based email queue with send-hour and daily-limit checks

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../../lib/supabase';
import { sendEmail } from './sender';

const MAX_DAILY_EMAILS = 100;
const SEND_HOUR_START = 12; // KST
const SEND_HOUR_END = 19;   // KST
const KST_OFFSET_HOURS = 9;

interface QueueEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
}

export async function enqueueEmail(
  supabase: SupabaseClient,
  emailId: string,
  scheduledAt: string | null
): Promise<void> {
  const updates: Record<string, unknown> = { status: 'queued' };
  if (scheduledAt) {
    updates['metadata'] = { scheduled_at: scheduledAt };
  }

  const { error } = await supabase
    .from('emails')
    .update(updates)
    .eq('id', emailId);

  if (error) {
    throw new Error(`Failed to enqueue email: ${error.message}`);
  }
}

function isWithinSendHours(): boolean {
  const now = new Date();
  const kstHour = (now.getUTCHours() + KST_OFFSET_HOURS) % 24;
  return kstHour >= SEND_HOUR_START && kstHour < SEND_HOUR_END;
}

async function getDailySentCount(
  supabase: SupabaseClient
): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('emails')
    .select('id', { count: 'exact', head: true })
    .in('status', ['sent', 'delivered'])
    .gte('sent_at', todayStart.toISOString());

  if (error) {
    throw new Error(`Failed to get daily count: ${error.message}`);
  }

  return count ?? 0;
}

async function getUnsubscribedEmails(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('unsubscribes')
    .select('email');

  if (error) {
    throw new Error(`Failed to get unsubscribes: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.email));
}

interface QueuedEmail {
  id: string;
  lead_id: string;
  subject: string;
  body_html: string;
  body_text: string | null;
  to_email: string;
  leads: { grade: string | null } | null;
  step_number: number | null;
}

function isQueuedEmail(value: unknown): value is QueuedEmail {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['id'] === 'string' &&
    typeof obj['to_email'] === 'string' &&
    typeof obj['subject'] === 'string' &&
    typeof obj['body_html'] === 'string'
  );
}

export async function processEmailQueue(
  env: QueueEnv
): Promise<{ sent: number; failed: number }> {
  if (!isWithinSendHours()) {
    return { sent: 0, failed: 0 };
  }

  const supabase = createSupabaseClient(env);
  const dailyCount = await getDailySentCount(supabase);

  if (dailyCount >= MAX_DAILY_EMAILS) {
    return { sent: 0, failed: 0 };
  }

  const remaining = MAX_DAILY_EMAILS - dailyCount;
  const unsubscribed = await getUnsubscribedEmails(supabase);

  const { data: queued, error } = await supabase
    .from('emails')
    .select('id, lead_id, subject, body_html, body_text, to_email, step_number, leads(grade)')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(Math.min(remaining, 10));

  if (error) {
    throw new Error(`Failed to fetch queued emails: ${error.message}`);
  }

  let sent = 0;
  let failed = 0;

  for (const row of queued ?? []) {
    if (!isQueuedEmail(row)) continue;

    if (unsubscribed.has(row.to_email)) {
      await supabase
        .from('emails')
        .update({ status: 'failed' })
        .eq('id', row.id);
      failed++;
      continue;
    }

    try {
      const leadData = row.leads as { grade: string | null } | null;
      const externalId = await sendEmail(
        {
          to: row.to_email,
          subject: row.subject,
          bodyHtml: row.body_html,
          bodyText: row.body_text,
          leadId: row.lead_id,
          emailId: row.id,
          grade: leadData?.grade ?? null,
          stepNumber: row.step_number,
        },
        env
      );

      await supabase
        .from('emails')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          external_id: externalId,
        })
        .eq('id', row.id);

      await supabase
        .from('leads')
        .update({
          last_email_sent_at: new Date().toISOString(),
          stage: 'contacted',
        })
        .eq('id', row.lead_id)
        .eq('stage', 'new');

      sent++;
    } catch (sendError) {
      const errMsg = sendError instanceof Error ? sendError.message : 'Unknown error';

      await supabase
        .from('emails')
        .update({ status: 'failed' })
        .eq('id', row.id);

      await supabase.from('lead_activities').insert({
        lead_id: row.lead_id,
        activity_type: 'email_bounced',
        title: '이메일 발송 실패',
        description: errMsg,
        actor: 'system',
      });

      failed++;
    }
  }

  return { sent, failed };
}
