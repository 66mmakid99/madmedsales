import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase';
import { verifyUnsubscribeToken } from '../services/ai/email-generator';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

interface DemoRequestBody {
  hospital_name: string;
  doctor_name: string;
  phone: string;
  email: string;
  demo_type: string;
  preferred_date: string;
  preferred_time: string;
  interest_area?: string;
  current_rf?: string;
  questions?: string;
}

interface DemoEvaluationBody {
  satisfaction_score: number;
  purchase_intent: string;
  preferred_payment: string;
  additional_questions?: string;
  feedback?: string;
}

const app = new Hono<{ Bindings: Bindings }>();

app.post('/demos/request', async (c) => {
  try {
    const body = await c.req.json<DemoRequestBody>();

    if (!body.hospital_name || !body.doctor_name || !body.phone || !body.email || !body.demo_type) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: '필수 항목을 입력해주세요.' } },
        400
      );
    }

    const supabase = createSupabaseClient(c.env);

    const { data: existingHospital } = await supabase
      .from('hospitals')
      .select('id')
      .eq('name', body.hospital_name)
      .maybeSingle();

    let hospitalId: string;

    if (existingHospital) {
      hospitalId = existingHospital.id;
    } else {
      const { data: newHospital, error: hospitalErr } = await supabase
        .from('hospitals')
        .insert({
          name: body.hospital_name,
          doctor_name: body.doctor_name,
          phone: body.phone,
          email: body.email,
          source: 'demo_request',
          status: 'active',
          is_target: true,
          data_quality_score: 30,
        })
        .select('id')
        .single();

      if (hospitalErr || !newHospital) {
        return c.json(
          { success: false, error: { code: 'HOSPITAL_CREATE_ERROR', message: hospitalErr?.message ?? '병원 정보 저장 실패' } },
          500
        );
      }
      hospitalId = newHospital.id;
    }

    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('hospital_id', hospitalId)
      .maybeSingle();

    let leadId: string;

    if (existingLead) {
      leadId = existingLead.id;
      await supabase
        .from('leads')
        .update({
          stage: 'demo_scheduled',
          interest_level: 'hot',
          contact_email: body.email,
          contact_name: body.doctor_name,
          updated_at: new Date().toISOString(),
        })
        .eq('id', leadId);
    } else {
      const { data: newLead, error: leadErr } = await supabase
        .from('leads')
        .insert({
          hospital_id: hospitalId,
          stage: 'demo_scheduled',
          interest_level: 'hot',
          priority: 100,
          contact_email: body.email,
          contact_name: body.doctor_name,
          contact_role: '원장',
          current_sequence_step: 0,
          open_count: 0,
          click_count: 0,
          reply_count: 0,
          demo_page_visits: 0,
          price_page_visits: 0,
          kakao_connected: false,
        })
        .select('id')
        .single();

      if (leadErr || !newLead) {
        return c.json(
          { success: false, error: { code: 'LEAD_CREATE_ERROR', message: leadErr?.message ?? '리드 생성 실패' } },
          500
        );
      }
      leadId = newLead.id;
    }

    const { data: demo, error: demoErr } = await supabase
      .from('demos')
      .insert({
        lead_id: leadId,
        hospital_id: hospitalId,
        demo_type: body.demo_type,
        requested_at: new Date().toISOString(),
        status: 'requested',
        notes: [
          body.interest_area ? `관심분야: ${body.interest_area}` : '',
          body.current_rf ? `현재 RF: ${body.current_rf}` : '',
          body.questions ? `질문: ${body.questions}` : '',
          `희망일시: ${body.preferred_date} ${body.preferred_time}`,
        ].filter(Boolean).join('\n'),
      })
      .select('id')
      .single();

    if (demoErr || !demo) {
      return c.json(
        { success: false, error: { code: 'DEMO_CREATE_ERROR', message: demoErr?.message ?? '데모 요청 저장 실패' } },
        500
      );
    }

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'demo_requested',
      title: '데모 요청 접수',
      description: `${body.hospital_name} - ${body.demo_type} 데모 요청`,
      metadata: {
        demo_id: demo.id,
        demo_type: body.demo_type,
        preferred_date: body.preferred_date,
        preferred_time: body.preferred_time,
      },
      actor: 'public_web',
    });

    return c.json({
      success: true,
      data: { demo_id: demo.id, message: '데모 요청이 접수되었습니다.' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DEMO_REQUEST_ERROR', message } },
      500
    );
  }
});

app.post('/demos/:id/evaluate', async (c) => {
  try {
    const demoId = c.req.param('id');
    const token = c.req.query('token');

    if (!token) {
      return c.json(
        { success: false, error: { code: 'INVALID_TOKEN', message: '유효하지 않은 토큰입니다.' } },
        401
      );
    }

    const body = await c.req.json<DemoEvaluationBody>();
    const supabase = createSupabaseClient(c.env);

    const { data: demo, error: demoErr } = await supabase
      .from('demos')
      .select('id, lead_id, status')
      .eq('id', demoId)
      .single();

    if (demoErr || !demo) {
      return c.json(
        { success: false, error: { code: 'DEMO_NOT_FOUND', message: '해당 데모를 찾을 수 없습니다.' } },
        404
      );
    }

    const { error: evalErr } = await supabase.from('demo_evaluations').insert({
      demo_id: demoId,
      lead_id: demo.lead_id,
      satisfaction_score: body.satisfaction_score,
      purchase_intent: body.purchase_intent,
      preferred_payment: body.preferred_payment,
      additional_questions: body.additional_questions ?? null,
      feedback: body.feedback ?? null,
      evaluated_at: new Date().toISOString(),
    });

    if (evalErr) {
      return c.json(
        { success: false, error: { code: 'EVALUATION_ERROR', message: evalErr.message } },
        500
      );
    }

    await supabase
      .from('demos')
      .update({ status: 'evaluated', updated_at: new Date().toISOString() })
      .eq('id', demoId);

    const interestUpdate: Record<string, unknown> = {};
    if (body.purchase_intent === 'immediate') {
      interestUpdate.stage = 'proposal';
      interestUpdate.interest_level = 'hot';
    } else if (body.purchase_intent === 'considering') {
      interestUpdate.stage = 'negotiation';
      interestUpdate.interest_level = 'warm';
    } else if (body.purchase_intent === 'hold') {
      interestUpdate.stage = 'nurturing';
      interestUpdate.interest_level = 'warming';
    }

    if (Object.keys(interestUpdate).length > 0) {
      interestUpdate.updated_at = new Date().toISOString();
      await supabase.from('leads').update(interestUpdate).eq('id', demo.lead_id);
    }

    await supabase.from('lead_activities').insert({
      lead_id: demo.lead_id,
      activity_type: 'demo_evaluated',
      title: '데모 평가 완료',
      description: `만족도: ${body.satisfaction_score}/5, 구매의향: ${body.purchase_intent}`,
      metadata: {
        demo_id: demoId,
        satisfaction_score: body.satisfaction_score,
        purchase_intent: body.purchase_intent,
      },
      actor: 'customer',
    });

    return c.json({
      success: true,
      data: { message: '평가가 제출되었습니다. 감사합니다.' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'EVALUATION_ERROR', message } },
      500
    );
  }
});

// GET /unsubscribe - handle unsubscribe with HMAC token verification
app.get('/unsubscribe', async (c) => {
  const leadId = c.req.query('lead');
  const token = c.req.query('token');

  if (!leadId || !token) {
    return c.html(renderUnsubscribePage('잘못된 요청', '유효하지 않은 수신거부 링크입니다.'), 400);
  }

  try {
    const isValid = await verifyUnsubscribeToken(leadId, token, c.env.RESEND_API_KEY);

    if (!isValid) {
      return c.html(
        renderUnsubscribePage('토큰 오류', '유효하지 않은 수신거부 링크입니다.'),
        403
      );
    }

    const supabase = createSupabaseClient(c.env);

    const { data: lead } = await supabase
      .from('leads')
      .select('id, contact_email, hospital_id')
      .eq('id', leadId)
      .single();

    if (!lead || !lead.contact_email) {
      return c.html(renderUnsubscribePage('오류', '수신자 정보를 찾을 수 없습니다.'), 404);
    }

    const { data: existing } = await supabase
      .from('unsubscribes')
      .select('id')
      .eq('email', lead.contact_email)
      .limit(1);

    if (existing && existing.length > 0) {
      return c.html(
        renderUnsubscribePage('이미 처리됨', '이미 수신거부 처리되어 있습니다.'),
        200
      );
    }

    await supabase.from('unsubscribes').insert({
      email: lead.contact_email,
      hospital_id: lead.hospital_id,
      reason: '이메일 내 수신거부 링크 클릭',
      unsubscribed_at: new Date().toISOString(),
    });

    await supabase
      .from('leads')
      .update({ stage: 'closed_lost', lost_reason: '수신거부', lost_at: new Date().toISOString() })
      .eq('id', leadId);

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'email_unsubscribed',
      title: '수신거부 처리',
      description: `${lead.contact_email} 수신거부`,
      actor: 'lead',
    });

    return c.html(
      renderUnsubscribePage('수신거부 처리되었습니다', '앞으로 MADMEDSALES에서 이메일을 보내지 않겠습니다. 감사합니다.'),
      200
    );
  } catch (error) {
    return c.html(
      renderUnsubscribePage('오류 발생', '처리 중 오류가 발생했습니다. 다시 시도해주세요.'),
      500
    );
  }
});

app.post('/unsubscribe', async (c) => {
  try {
    const body = await c.req.json<{ email: string; lead_id?: string; token?: string; reason?: string }>();

    if (!body.email) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'email is required' } },
        400
      );
    }

    const supabase = createSupabaseClient(c.env);

    await supabase.from('unsubscribes').insert({
      email: body.email,
      hospital_id: null,
      reason: body.reason ?? null,
      unsubscribed_at: new Date().toISOString(),
    });

    if (body.lead_id) {
      await supabase.from('lead_activities').insert({
        lead_id: body.lead_id,
        activity_type: 'email_unsubscribed',
        title: '수신 거부',
        description: body.reason ?? '수신 거부 처리됨',
        actor: 'customer',
      });
    }

    return c.json({
      success: true,
      data: { message: '수신 거부 처리가 완료되었습니다.' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'UNSUBSCRIBE_ERROR', message } },
      500
    );
  }
});

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderUnsubscribePage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - MADMEDSALES</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f5f5f5; color: #333; }
    .container { text-align: center; padding: 40px; background: white; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); max-width: 480px; }
    h1 { font-size: 24px; margin-bottom: 16px; }
    p { font-size: 16px; color: #666; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
  </div>
</body>
</html>`;
}

export default app;
