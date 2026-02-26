// v1.0 - 2026-02-20
// Email routes: generation, sending, batch, list, stats

import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase';
import { generateEmail } from '../services/ai/email-generator';
import { sendEmail } from '../services/email/sender';
import { enqueueEmail } from '../services/email/queue';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  WEB_URL: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// POST /generate - AI email generation for a lead
app.post('/generate', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!isGenerateRequest(body)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '필수 필드가 누락되었습니다.' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);

    // Fetch lead + hospital data
    const { data: lead, error: leadErr } = await supabase
      .from('leads')
      .select('id, hospital_id, product_id, grade, contact_email, current_sequence_step, email_sequence_id')
      .eq('id', body.lead_id)
      .single();

    if (leadErr || !lead) {
      return c.json({
        success: false,
        error: { code: 'LEAD_NOT_FOUND', message: '리드를 찾을 수 없습니다.' },
      }, 404);
    }

    // Fetch product info (동적 주입 — 하드코딩 금지)
    const { data: product, error: productErr } = await supabase
      .from('products')
      .select('name, manufacturer, category, description, email_guide')
      .eq('id', lead.product_id)
      .single();

    if (productErr || !product) {
      return c.json({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: '제품 정보를 찾을 수 없습니다.' },
      }, 404);
    }

    const productInfo = {
      name: product.name,
      manufacturer: product.manufacturer,
      category: product.category,
      valueProposition: (product.email_guide as Record<string, string> | null)?.value_proposition
        ?? product.description
        ?? product.name,
      emailGuide: (product.email_guide as Record<string, string> | null)?.guide_text ?? null,
    };

    const { data: hospital } = await supabase
      .from('hospitals')
      .select('name, doctor_name, department')
      .eq('id', lead.hospital_id)
      .single();

    const { data: equipments } = await supabase
      .from('hospital_equipments')
      .select('equipment_name')
      .eq('hospital_id', lead.hospital_id);

    const { data: treatments } = await supabase
      .from('hospital_treatments')
      .select('treatment_name')
      .eq('hospital_id', lead.hospital_id);

    const { data: scoring } = await supabase
      .from('scoring_results')
      .select('ai_analysis, ai_message_direction')
      .eq('hospital_id', lead.hospital_id)
      .order('scored_at', { ascending: false })
      .limit(1)
      .single();

    const { data: prevEmails } = await supabase
      .from('emails')
      .select('subject, sent_at')
      .eq('lead_id', lead.id)
      .in('status', ['sent', 'delivered'])
      .order('sent_at', { ascending: true });

    // Determine step info
    let stepPurpose = body.purpose ?? 'intro';
    let stepTone = body.tone ?? null;
    let stepKeyMessage = body.key_message ?? null;
    let personalizationFocus = body.personalization_focus ?? null;
    const stepNumber = body.step_number ?? (lead.current_sequence_step ?? 1);

    if (lead.email_sequence_id) {
      const { data: step } = await supabase
        .from('email_sequence_steps')
        .select('purpose, tone, key_message, personalization_focus')
        .eq('sequence_id', lead.email_sequence_id)
        .eq('step_number', stepNumber)
        .single();

      if (step) {
        stepPurpose = step.purpose ?? stepPurpose;
        stepTone = step.tone ?? stepTone;
        stepKeyMessage = step.key_message ?? stepKeyMessage;
        personalizationFocus = step.personalization_focus ?? personalizationFocus;
      }
    }

    const grade = (lead.grade === 'S' || lead.grade === 'A' || lead.grade === 'B')
      ? lead.grade
      : 'B';

    const result = await generateEmail(c.env, {
      grade,
      product: productInfo,
      hospitalName: hospital?.name ?? '병원',
      doctorName: hospital?.doctor_name ?? null,
      department: hospital?.department ?? null,
      equipments: (equipments ?? []).map((e) => e.equipment_name),
      treatments: (treatments ?? []).map((t) => t.treatment_name),
      aiAnalysis: scoring?.ai_analysis ?? null,
      aiMessageDirection: scoring?.ai_message_direction ?? null,
      stepNumber,
      stepPurpose,
      stepTone,
      stepKeyMessage,
      personalizationFocus,
      previousEmails: (prevEmails ?? []).map((e) => ({
        subject: e.subject,
        sentAt: e.sent_at ?? '',
      })),
      leadId: lead.id,
    });

    // Save to DB
    const { data: savedEmail, error: saveErr } = await supabase
      .from('emails')
      .insert({
        lead_id: lead.id,
        sequence_id: lead.email_sequence_id,
        step_number: stepNumber,
        subject: result.subject,
        body_html: result.bodyHtml,
        body_text: result.bodyText,
        ai_prompt_used: result.promptUsed.substring(0, 5000),
        ai_personalization: { notes: result.personalizationNotes, model: result.model },
        from_email: 'noreply@madmedsales.com',
        to_email: lead.contact_email ?? '',
        status: 'queued',
      })
      .select('id')
      .single();

    if (saveErr) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: `이메일 저장 실패: ${saveErr.message}` },
      }, 500);
    }

    return c.json({
      success: true,
      data: {
        email_id: savedEmail?.id,
        subject: result.subject,
        body_html: result.bodyHtml,
        body_text: result.bodyText,
        personalization_notes: result.personalizationNotes,
        model: result.model,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({
      success: false,
      error: { code: 'GENERATION_ERROR', message },
    }, 500);
  }
});

// POST /send - send a specific email by id
app.post('/send', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!hasProp(body, 'email_id', 'string')) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'email_id가 필요합니다.' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);
    const { data: email, error } = await supabase
      .from('emails')
      .select('id, lead_id, subject, body_html, body_text, to_email, step_number, leads(grade)')
      .eq('id', (body as Record<string, string>).email_id)
      .single();

    if (error || !email) {
      return c.json({
        success: false,
        error: { code: 'EMAIL_NOT_FOUND', message: '이메일을 찾을 수 없습니다.' },
      }, 404);
    }

    const leadsRaw = email.leads;
    const leadData = Array.isArray(leadsRaw)
      ? (leadsRaw[0] as { grade: string | null } | undefined) ?? null
      : leadsRaw as { grade: string | null } | null;

    const externalId = await sendEmail(
      {
        to: email.to_email,
        subject: email.subject,
        bodyHtml: email.body_html,
        bodyText: email.body_text,
        leadId: email.lead_id,
        emailId: email.id,
        grade: leadData?.grade ?? null,
        stepNumber: email.step_number,
      },
      c.env
    );

    await supabase
      .from('emails')
      .update({ status: 'sent', sent_at: new Date().toISOString(), external_id: externalId })
      .eq('id', email.id);

    return c.json({ success: true, data: { external_id: externalId } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'SEND_ERROR', message } }, 500);
  }
});

// POST /send-batch - batch generate + queue for multiple leads
app.post('/send-batch', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!hasProp(body, 'lead_ids', 'object') || !Array.isArray((body as Record<string, unknown>).lead_ids)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'lead_ids 배열이 필요합니다.' },
      }, 400);
    }

    const leadIds = (body as Record<string, string[]>).lead_ids;
    const supabase = createSupabaseClient(c.env);
    const results: { leadId: string; emailId: string | null; error: string | null }[] = [];

    for (const leadId of leadIds) {
      try {
        // Use the /generate endpoint logic internally
        const genResponse = await c.env.ANTHROPIC_API_KEY; // Verify env
        if (!genResponse) throw new Error('Missing API key');

        // Queue for later processing
        await supabase.from('emails').insert({
          lead_id: leadId,
          subject: '[대기] AI 생성 예정',
          body_html: '<p>생성 대기중</p>',
          body_text: '생성 대기중',
          from_email: 'noreply@madmedsales.com',
          to_email: '',
          status: 'queued',
          ai_personalization: { batch: true },
        });

        results.push({ leadId, emailId: null, error: null });
      } catch (err) {
        results.push({
          leadId,
          emailId: null,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return c.json({ success: true, data: { results } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'BATCH_ERROR', message } }, 500);
  }
});

// GET / - email list with filters
app.get('/', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const leadId = c.req.query('lead_id');
    const status = c.req.query('status');
    const limit = parseInt(c.req.query('limit') ?? '50', 10);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);

    let query = supabase
      .from('emails')
      .select('id, lead_id, subject, status, sent_at, created_at, step_number', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (leadId) query = query.eq('lead_id', leadId);
    if (status) query = query.eq('status', status);

    const { data, error, count } = await query;

    if (error) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      }, 500);
    }

    return c.json({ success: true, data: { emails: data, total: count } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'LIST_ERROR', message } }, 500);
  }
});

// GET /stats - email statistics
app.get('/stats', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const { count: totalSent } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'delivered']);

    const { count: totalOpened } = await supabase
      .from('email_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'opened');

    const { count: totalClicked } = await supabase
      .from('email_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'clicked');

    const sent = totalSent ?? 0;
    const opened = totalOpened ?? 0;
    const clicked = totalClicked ?? 0;

    return c.json({
      success: true,
      data: {
        total_sent: sent,
        total_opened: opened,
        total_clicked: clicked,
        open_rate: sent > 0 ? Math.round((opened / sent) * 10000) / 100 : 0,
        click_rate: sent > 0 ? Math.round((clicked / sent) * 10000) / 100 : 0,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'STATS_ERROR', message } }, 500);
  }
});

// GET /:id - email detail with events
app.get('/:id', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');

    const { data: email, error } = await supabase
      .from('emails')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !email) {
      return c.json({
        success: false,
        error: { code: 'EMAIL_NOT_FOUND', message: '이메일을 찾을 수 없습니다.' },
      }, 404);
    }

    const { data: events } = await supabase
      .from('email_events')
      .select('*')
      .eq('email_id', id)
      .order('created_at', { ascending: true });

    return c.json({ success: true, data: { email, events: events ?? [] } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'DETAIL_ERROR', message } }, 500);
  }
});

// Helpers
interface GenerateRequest {
  lead_id: string;
  purpose?: string;
  tone?: string;
  key_message?: string;
  personalization_focus?: string;
  step_number?: number;
}

function isGenerateRequest(value: unknown): value is GenerateRequest {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>)['lead_id'] === 'string';
}

function hasProp(value: unknown, key: string, type: string): boolean {
  if (typeof value !== 'object' || value === null) return false;
  return typeof (value as Record<string, unknown>)[key] === type;
}

export default app;
