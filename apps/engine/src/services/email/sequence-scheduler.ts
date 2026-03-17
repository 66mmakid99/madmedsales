// v1.0 - 2026-03-16
// Sequence step auto-scheduler: queues the next email step after a step is sent,
// based on delay_days defined in email_sequence_steps.

import type { SupabaseClient } from '@supabase/supabase-js';
import { T } from '../../lib/table-names';

interface SchedulerEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// Called after an email step is successfully sent.
// Looks up the next step in the sequence and creates a queued email record
// with a scheduled_at based on delay_days.
export async function scheduleNextStep(
  supabase: SupabaseClient,
  leadId: string,
  completedStepNumber: number
): Promise<void> {
  // Fetch the lead to get sequence assignment
  const { data: lead, error: leadErr } = await supabase
    .from(T.leads)
    .select('id, hospital_id, product_id, grade, contact_email, email_sequence_id, current_sequence_step')
    .eq('id', leadId)
    .single();

  if (leadErr || !lead || !lead.email_sequence_id) return;

  // Fetch the next step
  const nextStepNumber = completedStepNumber + 1;
  const { data: nextStep, error: stepErr } = await supabase
    .from(T.email_sequence_steps)
    .select('id, step_number, delay_days, purpose, tone, key_message')
    .eq('sequence_id', lead.email_sequence_id)
    .eq('step_number', nextStepNumber)
    .single();

  if (stepErr || !nextStep) return; // No more steps in sequence

  // Check if a queued/pending email already exists for this lead + step
  const { count: existing } = await supabase
    .from(T.emails)
    .select('id', { count: 'exact', head: true })
    .eq('lead_id', leadId)
    .eq('step_number', nextStepNumber)
    .in('status', ['queued', 'sent', 'delivered']);

  if ((existing ?? 0) > 0) return; // Already scheduled or sent

  // Calculate scheduled_at: now + delay_days
  const scheduledAt = new Date(
    Date.now() + nextStep.delay_days * 24 * 60 * 60 * 1000
  ).toISOString();

  // Insert a placeholder email in queued state — AI generation happens at send time
  // The queue processor picks this up when scheduledAt is reached
  const { error: insertErr } = await supabase
    .from(T.emails)
    .insert({
      lead_id: leadId,
      sequence_id: lead.email_sequence_id,
      step_number: nextStepNumber,
      subject: '',          // To be filled by AI generation before send
      body_html: '',
      body_text: null,
      from_email: 'noreply@madmedsales.com',
      to_email: lead.contact_email ?? '',
      status: 'scheduled',
      ai_personalization: {
        scheduled: true,
        scheduled_at: scheduledAt,
        step_purpose: nextStep.purpose,
      },
    });

  if (insertErr) {
    throw new Error(`scheduleNextStep insert failed: ${insertErr.message}`);
  }

  // Advance current_sequence_step on the lead
  await supabase
    .from(T.leads)
    .update({ current_sequence_step: nextStepNumber })
    .eq('id', leadId);
}

// Called by the cron handler: promote emails whose scheduled_at has passed to 'queued'
// so they get picked up by processEmailQueue.
export async function promoteScheduledEmails(
  supabase: SupabaseClient
): Promise<number> {
  const now = new Date().toISOString();

  // Emails in 'scheduled' status whose scheduled_at (stored in ai_personalization) <= now
  const { data: scheduled, error } = await supabase
    .from(T.emails)
    .select('id, ai_personalization')
    .eq('status', 'scheduled');

  if (error || !scheduled) return 0;

  let promoted = 0;
  for (const email of scheduled) {
    const meta = email.ai_personalization as Record<string, unknown> | null;
    const scheduledAt = typeof meta?.['scheduled_at'] === 'string' ? meta['scheduled_at'] : null;
    if (scheduledAt && scheduledAt <= now) {
      await supabase
        .from(T.emails)
        .update({ status: 'queued' })
        .eq('id', email.id);
      promoted++;
    }
  }

  return promoted;
}

// Initialise warmup start date in KV if not set yet.
// Call once when the first real email is sent.
export async function ensureWarmupStartDate(
  env: SchedulerEnv & { SETTINGS_KV?: KVNamespace }
): Promise<void> {
  if (!env.SETTINGS_KV) return;
  const existing = await env.SETTINGS_KV.get('email_warmup_start_date');
  if (!existing) {
    await env.SETTINGS_KV.put(
      'email_warmup_start_date',
      new Date().toISOString()
    );
  }
}
