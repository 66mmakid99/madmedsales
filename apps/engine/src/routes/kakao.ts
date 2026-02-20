// v1.0 - 2026-02-20
// Kakao routes: alimtalk sending, message history, webhook

import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase';
import { sendAlimtalk } from '../services/kakao/biz-message';
import { getTemplate } from '../services/kakao/templates';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  KAKAO_API_KEY: string;
  KAKAO_SENDER_KEY: string;
  WEB_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// POST /send-alimtalk - send alimtalk message
app.post('/send-alimtalk', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!isSendAlimtalkRequest(body)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'lead_id, template_code, phone, template_params 필수' },
      }, 400);
    }

    const template = getTemplate(body.template_code);
    if (!template) {
      return c.json({
        success: false,
        error: { code: 'INVALID_TEMPLATE', message: `존재하지 않는 템플릿: ${body.template_code}` },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);

    await sendAlimtalk(c.env, supabase, {
      leadId: body.lead_id,
      templateCode: body.template_code,
      recipientPhone: body.phone,
      templateParams: body.template_params,
    });

    return c.json({ success: true, data: { message: '알림톡 발송 완료' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: { code: 'KAKAO_SEND_ERROR', message },
    }, 500);
  }
});

// POST /send-welcome - send welcome message when channel added
app.post('/send-welcome', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!isWelcomeRequest(body)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'lead_id, phone, doctor_name 필수' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);

    await sendAlimtalk(c.env, supabase, {
      leadId: body.lead_id,
      templateCode: 'WELCOME',
      recipientPhone: body.phone,
      templateParams: {
        doctorName: body.doctor_name,
      },
    });

    // Update lead kakao status
    await supabase
      .from('leads')
      .update({
        kakao_connected: true,
        stage: 'kakao_connected',
      })
      .eq('id', body.lead_id);

    await supabase.from('lead_activities').insert({
      lead_id: body.lead_id,
      activity_type: 'kakao_connected',
      title: '카카오 채널 추가 + 환영 메시지 발송',
      actor: 'system',
    });

    return c.json({ success: true, data: { message: '환영 메시지 발송 완료' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: { code: 'WELCOME_ERROR', message },
    }, 500);
  }
});

// GET /messages - kakao message history for a lead
app.get('/messages', async (c) => {
  try {
    const leadId = c.req.query('lead_id');
    if (!leadId) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'lead_id 쿼리 파라미터 필수' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    const { data, error, count } = await supabase
      .from('kakao_messages')
      .select('*', { count: 'exact' })
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      }, 500);
    }

    return c.json({ success: true, data: { messages: data, total: count } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'LIST_ERROR', message } }, 500);
  }
});

// POST /webhooks/kakao - kakao callback (channel add/remove)
app.post('/webhooks/kakao', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!isKakaoCallback(body)) {
      return c.json({ error: 'Invalid callback payload' }, 400);
    }

    const supabase = createSupabaseClient(c.env);

    if (body.event === 'added') {
      // Find lead by kakao user id or phone
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('kakao_channel_user_id', body.user_key)
        .single();

      if (lead) {
        await supabase
          .from('leads')
          .update({ kakao_connected: true, stage: 'kakao_connected' })
          .eq('id', lead.id);

        await supabase.from('lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'kakao_connected',
          title: '카카오 채널 추가됨',
          metadata: { user_key: body.user_key },
          actor: 'lead',
        });
      }
    } else if (body.event === 'removed') {
      const { data: lead } = await supabase
        .from('leads')
        .select('id')
        .eq('kakao_channel_user_id', body.user_key)
        .single();

      if (lead) {
        await supabase
          .from('leads')
          .update({ kakao_connected: false })
          .eq('id', lead.id);

        await supabase.from('lead_activities').insert({
          lead_id: lead.id,
          activity_type: 'note_added',
          title: '카카오 채널 차단됨',
          metadata: { user_key: body.user_key },
          actor: 'lead',
        });
      }
    }

    return c.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ error: `Kakao webhook failed: ${message}` }, 500);
  }
});

// Type guards
interface SendAlimtalkRequest {
  lead_id: string;
  template_code: string;
  phone: string;
  template_params: Record<string, string>;
}

function isSendAlimtalkRequest(value: unknown): value is SendAlimtalkRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['lead_id'] === 'string' &&
    typeof obj['template_code'] === 'string' &&
    typeof obj['phone'] === 'string' &&
    typeof obj['template_params'] === 'object' &&
    obj['template_params'] !== null
  );
}

interface WelcomeRequest {
  lead_id: string;
  phone: string;
  doctor_name: string;
}

function isWelcomeRequest(value: unknown): value is WelcomeRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['lead_id'] === 'string' &&
    typeof obj['phone'] === 'string' &&
    typeof obj['doctor_name'] === 'string'
  );
}

interface KakaoCallback {
  event: 'added' | 'removed';
  user_key: string;
}

function isKakaoCallback(value: unknown): value is KakaoCallback {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    (obj['event'] === 'added' || obj['event'] === 'removed') &&
    typeof obj['user_key'] === 'string'
  );
}

export default app;
