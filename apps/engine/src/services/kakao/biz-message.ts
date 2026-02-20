// v1.0 - 2026-02-20
// Kakao Alimtalk (biz message) sending service

import type { SupabaseClient } from '@supabase/supabase-js';
import { getTemplate, fillTemplateParams, type KakaoButton } from './templates';

const KAKAO_ALIMTALK_API = 'https://kapi.kakao.com/v2/api/talk/biz/send';

export interface AlimtalkRequest {
  leadId: string;
  templateCode: string;
  recipientPhone: string;
  templateParams: Record<string, string>;
}

interface KakaoEnv {
  KAKAO_API_KEY: string;
  KAKAO_SENDER_KEY: string;
  WEB_URL: string;
}

interface KakaoApiResponse {
  successful_cnt: number;
  fail_cnt: number;
}

function isKakaoResponse(value: unknown): value is KakaoApiResponse {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['successful_cnt'] === 'number';
}

function buildButtons(
  buttons: KakaoButton[],
  params: Record<string, string>
): { type: string; name: string; url_mobile?: string; url_pc?: string }[] {
  return buttons.map((btn) => ({
    type: btn.type,
    name: btn.name,
    url_mobile: btn.linkMobile
      ? fillTemplateParams(btn.linkMobile, params)
      : undefined,
    url_pc: btn.linkPc
      ? fillTemplateParams(btn.linkPc, params)
      : undefined,
  }));
}

export async function sendAlimtalk(
  env: KakaoEnv,
  supabase: SupabaseClient,
  request: AlimtalkRequest
): Promise<void> {
  const template = getTemplate(request.templateCode);
  if (!template) {
    throw new Error(`Unknown template code: ${request.templateCode}`);
  }

  const paramsWithUrl = {
    ...request.templateParams,
    webUrl: env.WEB_URL,
  };

  const content = fillTemplateParams(template.content, paramsWithUrl);
  const buttons = buildButtons(template.buttons, paramsWithUrl);

  const payload = {
    sender_key: env.KAKAO_SENDER_KEY,
    template_code: request.templateCode,
    receiver_list: [
      {
        receiver_number: request.recipientPhone,
        template_parameter: request.templateParams,
        button: buttons,
      },
    ],
  };

  try {
    const response = await fetch(KAKAO_ALIMTALK_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `KakaoAK ${env.KAKAO_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Kakao API error: ${response.status} - ${errBody}`);
    }

    const data: unknown = await response.json();
    if (!isKakaoResponse(data)) {
      throw new Error('Invalid Kakao API response');
    }

    if (data.fail_cnt > 0) {
      throw new Error('Kakao alimtalk send partially failed');
    }

    // Record to kakao_messages table
    await supabase.from('kakao_messages').insert({
      lead_id: request.leadId,
      message_type: 'alimtalk',
      template_code: request.templateCode,
      content,
      direction: 'outbound',
      status: 'sent',
      sent_at: new Date().toISOString(),
    });

    // Log activity
    await supabase.from('lead_activities').insert({
      lead_id: request.leadId,
      activity_type: 'kakao_sent',
      title: `카카오 알림톡 발송: ${template.name}`,
      metadata: { template_code: request.templateCode },
      actor: 'system',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Record failed message
    await supabase.from('kakao_messages').insert({
      lead_id: request.leadId,
      message_type: 'alimtalk',
      template_code: request.templateCode,
      content: fillTemplateParams(template.content, paramsWithUrl),
      direction: 'outbound',
      status: 'failed',
    });

    throw new Error(`Alimtalk send failed: ${message}`);
  }
}
