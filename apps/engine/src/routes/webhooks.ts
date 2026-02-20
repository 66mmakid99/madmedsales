// v1.0 - 2026-02-20
// Webhook routes: Resend email events + inbound email replies (NO auth middleware)

import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase';
import { processEmailEvent } from '../services/email/tracker';
import { analyzeReply } from '../services/ai/response-analyzer';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  ANTHROPIC_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// POST /email - Resend webhook handler
app.post('/email', async (c) => {
  try {
    const svixId = c.req.header('svix-id');
    const svixTimestamp = c.req.header('svix-timestamp');
    const svixSignature = c.req.header('svix-signature');

    if (!svixId || !svixTimestamp || !svixSignature) {
      return c.json({ error: 'Missing webhook signature headers' }, 400);
    }

    const rawBody = await c.req.text();

    // Verify webhook signature
    const isValid = await verifyWebhookSignature(
      rawBody,
      svixId,
      svixTimestamp,
      svixSignature,
      c.env.RESEND_WEBHOOK_SECRET
    );

    if (!isValid) {
      return c.json({ error: 'Invalid webhook signature' }, 401);
    }

    const payload: unknown = JSON.parse(rawBody);
    if (!isWebhookPayload(payload)) {
      return c.json({ error: 'Invalid payload' }, 400);
    }

    const supabase = createSupabaseClient(c.env);

    // Map Resend event type to our event type
    const eventType = mapResendEventType(payload.type);
    if (!eventType) {
      return c.json({ received: true });
    }

    // Find email by external_id (Resend email ID)
    const resendEmailId = payload.data.email_id;
    const { data: email } = await supabase
      .from('emails')
      .select('id, lead_id')
      .eq('external_id', resendEmailId)
      .single();

    if (!email) {
      // Try matching by custom headers
      return c.json({ received: true, matched: false });
    }

    await processEmailEvent(supabase, {
      emailId: email.id,
      leadId: email.lead_id,
      eventType,
      clickedUrl: payload.data.click?.url ?? null,
      ipAddress: payload.data.click?.ipAddress ?? null,
      userAgent: payload.data.click?.userAgent ?? null,
      metadata: { resend_event_id: svixId, raw_type: payload.type },
    });

    return c.json({ received: true, processed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: `Webhook processing failed: ${message}` }, 500);
  }
});

// POST /email-reply - Resend inbound email handler
app.post('/email-reply', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!isInboundEmailPayload(body)) {
      return c.json({ error: 'Invalid inbound email payload' }, 400);
    }

    const supabase = createSupabaseClient(c.env);
    const senderEmail = body.from;

    // Match sender to lead
    const { data: lead } = await supabase
      .from('leads')
      .select('id, hospital_id, contact_email')
      .eq('contact_email', senderEmail)
      .single();

    if (!lead) {
      return c.json({ received: true, matched: false });
    }

    // Get the most recent sent email to this lead
    const { data: lastEmail } = await supabase
      .from('emails')
      .select('id, subject, body_text')
      .eq('lead_id', lead.id)
      .in('status', ['sent', 'delivered'])
      .order('sent_at', { ascending: false })
      .limit(1)
      .single();

    // Analyze the reply with AI
    const analysis = await analyzeReply(
      c.env,
      {
        subject: lastEmail?.subject ?? '(이전 이메일 없음)',
        summary: lastEmail?.body_text?.substring(0, 200) ?? '',
      },
      body.text ?? body.html ?? ''
    );

    // Update lead
    const leadUpdates: Record<string, unknown> = {
      reply_count: lead.id, // Will use RPC ideally
      last_replied_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await supabase.rpc('increment_lead_counter', {
      p_lead_id: lead.id,
      p_field: 'reply_count',
    });

    await supabase
      .from('leads')
      .update({
        last_replied_at: new Date().toISOString(),
        stage: 'responded',
      })
      .eq('id', lead.id);

    // Log activity with analysis
    await supabase.from('lead_activities').insert({
      lead_id: lead.id,
      activity_type: 'email_replied',
      title: `회신 수신: ${analysis.summary}`,
      description: body.text?.substring(0, 500) ?? null,
      metadata: {
        sentiment: analysis.sentiment,
        purchase_intent: analysis.purchase_intent,
        reply_type: analysis.reply_type,
        key_concern: analysis.key_concern,
        recommended_response: analysis.recommended_response,
        should_connect_kakao: analysis.should_connect_kakao,
        urgency: analysis.urgency,
        in_reply_to_email_id: lastEmail?.id ?? null,
      },
      actor: 'system',
    });

    // Notify admin if needed
    if (analysis.should_notify_admin) {
      await supabase.from('lead_activities').insert({
        lead_id: lead.id,
        activity_type: 'note_added',
        title: `[관리자 알림] ${analysis.urgency === 'immediate' ? '긴급' : '확인필요'}: ${analysis.summary}`,
        metadata: { notification: true, urgency: analysis.urgency },
        actor: 'system',
      });
    }

    return c.json({ received: true, analyzed: true, sentiment: analysis.sentiment });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: `Reply processing failed: ${message}` }, 500);
  }
});

// Signature verification
async function verifyWebhookSignature(
  body: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  secret: string
): Promise<boolean> {
  try {
    // Resend uses svix for webhooks
    // Secret format: whsec_<base64>
    const secretBytes = base64ToBytes(secret.replace('whsec_', ''));

    const toSign = `${svixId}.${svixTimestamp}.${body}`;
    const encoder = new TextEncoder();

    const key = await crypto.subtle.importKey(
      'raw',
      secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(toSign)
    );

    const expectedSig = bytesToBase64(new Uint8Array(signature));

    // svix-signature can contain multiple signatures separated by spaces
    const signatures = svixSignature.split(' ');
    return signatures.some((sig) => {
      const sigValue = sig.replace(/^v\d+,/, '');
      return sigValue === expectedSig;
    });
  } catch {
    return false;
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// Event type mapping
function mapResendEventType(resendType: string): string | null {
  const map: Record<string, string> = {
    'email.delivered': 'delivered',
    'email.opened': 'opened',
    'email.clicked': 'clicked',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
  };
  return map[resendType] ?? null;
}

// Type guards
interface WebhookPayload {
  type: string;
  data: {
    email_id: string;
    click?: {
      url: string;
      ipAddress?: string;
      userAgent?: string;
    };
  };
}

function isWebhookPayload(value: unknown): value is WebhookPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj['type'] !== 'string') return false;
  if (typeof obj['data'] !== 'object' || obj['data'] === null) return false;
  const data = obj['data'] as Record<string, unknown>;
  return typeof data['email_id'] === 'string';
}

interface InboundEmailPayload {
  from: string;
  to: string;
  subject: string;
  text: string | null;
  html: string | null;
}

function isInboundEmailPayload(value: unknown): value is InboundEmailPayload {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['from'] === 'string' && typeof obj['to'] === 'string';
}

export default app;
