// v1.1 - 2026-03-16
// DB-based email queue with weekday, send-hour, warmup, and multi-product dedup checks

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseClient } from '../../lib/supabase';
import { sendEmail } from './sender';
import { scheduleNextStep, promoteScheduledEmails, ensureWarmupStartDate } from './sequence-scheduler';
import { T } from '../../lib/table-names';

// Warmup schedule: daily limit increases by week since first send
const WARMUP_LIMITS: Record<number, number> = { 1: 10, 2: 20, 3: 30 };
const WARMUP_DEFAULT_LIMIT = 50; // Week 4+
const SEND_HOUR_START = 12; // KST
const SEND_HOUR_END = 19;   // KST
const KST_OFFSET_HOURS = 9;
// Multi-product dedup: block same hospital if any product mail sent within this window
const HOSPITAL_DEDUP_DAYS = 7;

interface QueueEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  SETTINGS_KV?: KVNamespace;
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
    .from(T.emails)
    .update(updates)
    .eq('id', emailId);

  if (error) {
    throw new Error(`Failed to enqueue email: ${error.message}`);
  }
}

function isWithinSendWindow(): boolean {
  const now = new Date();
  const kstMs = now.getTime() + KST_OFFSET_HOURS * 3600 * 1000;
  const kst = new Date(kstMs);
  const kstHour = kst.getUTCHours();
  const kstDay = kst.getUTCDay(); // 0=Sun, 6=Sat
  const isWeekday = kstDay >= 1 && kstDay <= 5;
  const isInHours = kstHour >= SEND_HOUR_START && kstHour < SEND_HOUR_END;
  return isWeekday && isInHours;
}

// Resolve daily limit based on warmup phase stored in KV
// Week 1=10, Week 2=20, Week 3=30, Week 4+=50
async function getDailyLimit(env: QueueEnv): Promise<number> {
  if (!env.SETTINGS_KV) return WARMUP_DEFAULT_LIMIT;
  try {
    const raw = await env.SETTINGS_KV.get('email_warmup_start_date');
    if (!raw) return WARMUP_DEFAULT_LIMIT;
    const startDate = new Date(raw);
    const diffDays = Math.floor(
      (Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24)
    );
    const week = Math.max(1, Math.ceil((diffDays + 1) / 7));
    return WARMUP_LIMITS[week] ?? WARMUP_DEFAULT_LIMIT;
  } catch {
    return WARMUP_DEFAULT_LIMIT;
  }
}

// Return set of hospital_ids that already received ANY product email in the last HOSPITAL_DEDUP_DAYS
async function getRecentlyContactedHospitals(
  supabase: SupabaseClient
): Promise<Set<string>> {
  const since = new Date(
    Date.now() - HOSPITAL_DEDUP_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  // emails -> leads (hospital_id)
  const { data, error } = await supabase
    .from(T.emails)
    .select('leads(hospital_id)')
    .in('status', ['sent', 'delivered'])
    .gte('sent_at', since);

  if (error || !data) return new Set();

  const hospitalIds = new Set<string>();
  for (const row of data) {
    const leads = row.leads as { hospital_id: string } | { hospital_id: string }[] | null;
    if (!leads) continue;
    const lead = Array.isArray(leads) ? leads[0] : leads;
    if (lead?.hospital_id) hospitalIds.add(lead.hospital_id);
  }
  return hospitalIds;
}

async function getDailySentCount(
  supabase: SupabaseClient
): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from(T.emails)
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
    .from(T.unsubscribes)
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
  leads: { grade: string | null; hospital_id: string | null; product_id: string | null } | null;
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
  if (!isWithinSendWindow()) {
    return { sent: 0, failed: 0 };
  }

  const supabase = createSupabaseClient(env);

  // Promote any scheduled emails whose delay_days window has passed
  await promoteScheduledEmails(supabase);

  // Ensure warmup start date is recorded (idempotent)
  await ensureWarmupStartDate(env);

  const dailyLimit = await getDailyLimit(env);
  const dailyCount = await getDailySentCount(supabase);

  if (dailyCount >= dailyLimit) {
    return { sent: 0, failed: 0 };
  }

  const remaining = dailyLimit - dailyCount;
  const unsubscribed = await getUnsubscribedEmails(supabase);
  const recentHospitals = await getRecentlyContactedHospitals(supabase);

  const { data: queued, error } = await supabase
    .from(T.emails)
    .select('id, lead_id, subject, body_html, body_text, to_email, step_number, leads(grade, hospital_id, product_id)')
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
        .from(T.emails)
        .update({ status: 'failed' })
        .eq('id', row.id);
      failed++;
      continue;
    }

    // Multi-product dedup: skip if same hospital got any email in the last HOSPITAL_DEDUP_DAYS
    const leadData = row.leads as { grade: string | null; hospital_id: string | null; product_id: string | null } | null;
    const hospitalId = leadData?.hospital_id ?? null;
    if (hospitalId && recentHospitals.has(hospitalId)) {
      // Keep as queued — will retry in the next window
      continue;
    }

    try {
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
          productId: leadData?.product_id ?? null,
        },
        env
      );

      await supabase
        .from(T.emails)
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          external_id: externalId,
        })
        .eq('id', row.id);

      await supabase
        .from(T.leads)
        .update({
          last_email_sent_at: new Date().toISOString(),
          stage: 'contacted',
        })
        .eq('id', row.lead_id)
        .eq('stage', 'new');

      // Mark this hospital as recently contacted for subsequent rows in this batch
      if (hospitalId) recentHospitals.add(hospitalId);

      // Auto-schedule next sequence step based on delay_days
      if (row.step_number !== null) {
        try {
          await scheduleNextStep(supabase, row.lead_id, row.step_number);
        } catch {
          // Non-fatal: scheduling failure should not block sent count
        }
      }

      sent++;
    } catch (sendError) {
      const errMsg = sendError instanceof Error ? sendError.message : 'Unknown error';

      await supabase
        .from(T.emails)
        .update({ status: 'failed' })
        .eq('id', row.id);

      await supabase.from(T.lead_activities).insert({
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
