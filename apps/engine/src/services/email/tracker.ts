// v1.0 - 2026-02-20
// Email event tracking and lead activity logging

import type { SupabaseClient } from '@supabase/supabase-js';

export interface EmailEventInput {
  emailId: string;
  leadId: string;
  eventType: string;
  clickedUrl: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
}

const PAGE_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\/demo/, label: 'demo_page' },
  { pattern: /\/price|\/pricing/, label: 'price_page' },
  { pattern: /\/product|\/torr/, label: 'product_page' },
  { pattern: /\/case|\/result/, label: 'case_study' },
  { pattern: /\/contact/, label: 'contact_page' },
  { pattern: /\/faq/, label: 'faq_page' },
];

export function classifyClickedPage(url: string): string | null {
  for (const { pattern, label } of PAGE_PATTERNS) {
    if (pattern.test(url)) {
      return label;
    }
  }
  return null;
}

export async function processEmailEvent(
  supabase: SupabaseClient,
  event: EmailEventInput
): Promise<void> {
  // 1. Insert email event
  const clickedPage = event.clickedUrl
    ? classifyClickedPage(event.clickedUrl)
    : null;

  const { error: eventError } = await supabase
    .from('email_events')
    .insert({
      email_id: event.emailId,
      lead_id: event.leadId,
      event_type: event.eventType,
      clicked_url: event.clickedUrl,
      clicked_page: clickedPage,
      ip_address: event.ipAddress,
      user_agent: event.userAgent,
      metadata: event.metadata,
    });

  if (eventError) {
    throw new Error(`Failed to insert email event: ${eventError.message}`);
  }

  // 2. Update email status
  await updateEmailStatus(supabase, event.emailId, event.eventType);

  // 3. Update lead counters and timestamps
  await updateLeadFromEvent(supabase, event.leadId, event.eventType, clickedPage);

  // 4. Log activity
  await logActivity(supabase, event);
}

async function updateEmailStatus(
  supabase: SupabaseClient,
  emailId: string,
  eventType: string
): Promise<void> {
  const statusMap: Record<string, string> = {
    delivered: 'delivered',
    bounced: 'bounced',
  };

  const newStatus = statusMap[eventType];
  if (!newStatus) return;

  const { error } = await supabase
    .from('emails')
    .update({ status: newStatus })
    .eq('id', emailId);

  if (error) {
    throw new Error(`Failed to update email status: ${error.message}`);
  }
}

async function updateLeadFromEvent(
  supabase: SupabaseClient,
  leadId: string,
  eventType: string,
  clickedPage: string | null
): Promise<void> {
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  switch (eventType) {
    case 'opened':
      updates['last_email_opened_at'] = new Date().toISOString();
      break;
    case 'clicked':
      updates['last_email_clicked_at'] = new Date().toISOString();
      break;
  }

  // Use RPC for atomic counter increments
  if (eventType === 'opened') {
    const { error } = await supabase.rpc('increment_lead_counter', {
      p_lead_id: leadId,
      p_field: 'open_count',
    });
    if (error) {
      // Fallback: direct update if RPC not available
      await supabase
        .from('leads')
        .update({ last_email_opened_at: new Date().toISOString() })
        .eq('id', leadId);
    }
  } else if (eventType === 'clicked') {
    const { error } = await supabase.rpc('increment_lead_counter', {
      p_lead_id: leadId,
      p_field: 'click_count',
    });
    if (error) {
      await supabase
        .from('leads')
        .update({ last_email_clicked_at: new Date().toISOString() })
        .eq('id', leadId);
    }

    // Track page visits
    if (clickedPage === 'demo_page') {
      await supabase.rpc('increment_lead_counter', {
        p_lead_id: leadId,
        p_field: 'demo_page_visits',
      });
    } else if (clickedPage === 'price_page') {
      await supabase.rpc('increment_lead_counter', {
        p_lead_id: leadId,
        p_field: 'price_page_visits',
      });
    }
  }
}

async function logActivity(
  supabase: SupabaseClient,
  event: EmailEventInput
): Promise<void> {
  const activityMap: Record<string, { type: string; title: string }> = {
    delivered: { type: 'email_sent', title: '이메일 전달 완료' },
    opened: { type: 'email_opened', title: '이메일 열람' },
    clicked: { type: 'email_clicked', title: '이메일 링크 클릭' },
    bounced: { type: 'email_bounced', title: '이메일 바운스' },
    complained: { type: 'email_unsubscribed', title: '스팸 신고' },
  };

  const activity = activityMap[event.eventType];
  if (!activity) return;

  const { error } = await supabase.from('lead_activities').insert({
    lead_id: event.leadId,
    activity_type: activity.type,
    title: activity.title,
    description: event.clickedUrl
      ? `클릭 URL: ${event.clickedUrl}`
      : null,
    metadata: event.metadata,
    actor: 'system',
  });

  if (error) {
    throw new Error(`Failed to log activity: ${error.message}`);
  }
}
