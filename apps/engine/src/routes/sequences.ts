// v1.0 - 2026-02-20
// Sequence routes: CRUD for email sequences and steps

import { Hono } from 'hono';
import { createSupabaseClient } from '../lib/supabase';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();

// GET / - sequence list
app.get('/', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const grade = c.req.query('grade');
    const activeOnly = c.req.query('active') === 'true';

    let query = supabase
      .from('email_sequences')
      .select('*')
      .order('created_at', { ascending: false });

    if (grade) query = query.eq('target_grade', grade);
    if (activeOnly) query = query.eq('is_active', true);

    const { data, error } = await query;

    if (error) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      }, 500);
    }

    return c.json({ success: true, data: { sequences: data } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'LIST_ERROR', message } }, 500);
  }
});

// GET /:id - sequence detail with steps
app.get('/:id', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const id = c.req.param('id');

    const { data: sequence, error } = await supabase
      .from('email_sequences')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !sequence) {
      return c.json({
        success: false,
        error: { code: 'SEQUENCE_NOT_FOUND', message: '시퀀스를 찾을 수 없습니다.' },
      }, 404);
    }

    const { data: steps } = await supabase
      .from('email_sequence_steps')
      .select('*')
      .eq('sequence_id', id)
      .order('step_number', { ascending: true });

    return c.json({
      success: true,
      data: { sequence, steps: steps ?? [] },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'DETAIL_ERROR', message } }, 500);
  }
});

// POST / - create sequence
app.post('/', async (c) => {
  try {
    const body: unknown = await c.req.json();
    if (!isCreateSequenceRequest(body)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'name, target_grade 필수' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from('email_sequences')
      .insert({
        name: body.name,
        target_grade: body.target_grade,
        description: body.description ?? null,
        is_active: body.is_active ?? true,
      })
      .select('*')
      .single();

    if (error) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      }, 500);
    }

    return c.json({ success: true, data: { sequence: data } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CREATE_ERROR', message } }, 500);
  }
});

// PUT /:id - update sequence
app.put('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body: unknown = await c.req.json();
    if (typeof body !== 'object' || body === null) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '업데이트할 데이터가 필요합니다.' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);
    const updates: Record<string, unknown> = {};
    const obj = body as Record<string, unknown>;

    if (typeof obj['name'] === 'string') updates['name'] = obj['name'];
    if (typeof obj['target_grade'] === 'string') updates['target_grade'] = obj['target_grade'];
    if (typeof obj['description'] === 'string') updates['description'] = obj['description'];
    if (typeof obj['is_active'] === 'boolean') updates['is_active'] = obj['is_active'];

    updates['updated_at'] = new Date().toISOString();

    const { data, error } = await supabase
      .from('email_sequences')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      }, 500);
    }

    return c.json({ success: true, data: { sequence: data } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'UPDATE_ERROR', message } }, 500);
  }
});

// POST /:id/steps - add step to sequence
app.post('/:id/steps', async (c) => {
  try {
    const sequenceId = c.req.param('id');
    const body: unknown = await c.req.json();
    if (!isCreateStepRequest(body)) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'step_number, delay_days, purpose 필수' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from('email_sequence_steps')
      .insert({
        sequence_id: sequenceId,
        step_number: body.step_number,
        delay_days: body.delay_days,
        purpose: body.purpose,
        tone: body.tone ?? null,
        key_message: body.key_message ?? null,
        personalization_focus: body.personalization_focus ?? null,
        skip_if: body.skip_if ?? null,
        upgrade_if: body.upgrade_if ?? null,
      })
      .select('*')
      .single();

    if (error) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      }, 500);
    }

    return c.json({ success: true, data: { step: data } }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CREATE_STEP_ERROR', message } }, 500);
  }
});

// PUT /:id/steps/:stepId - update step
app.put('/:id/steps/:stepId', async (c) => {
  try {
    const stepId = c.req.param('stepId');
    const body: unknown = await c.req.json();
    if (typeof body !== 'object' || body === null) {
      return c.json({
        success: false,
        error: { code: 'INVALID_INPUT', message: '업데이트할 데이터가 필요합니다.' },
      }, 400);
    }

    const supabase = createSupabaseClient(c.env);
    const updates: Record<string, unknown> = {};
    const obj = body as Record<string, unknown>;

    if (typeof obj['step_number'] === 'number') updates['step_number'] = obj['step_number'];
    if (typeof obj['delay_days'] === 'number') updates['delay_days'] = obj['delay_days'];
    if (typeof obj['purpose'] === 'string') updates['purpose'] = obj['purpose'];
    if (typeof obj['tone'] === 'string') updates['tone'] = obj['tone'];
    if (typeof obj['key_message'] === 'string') updates['key_message'] = obj['key_message'];
    if (typeof obj['personalization_focus'] === 'string') {
      updates['personalization_focus'] = obj['personalization_focus'];
    }

    const { data, error } = await supabase
      .from('email_sequence_steps')
      .update(updates)
      .eq('id', stepId)
      .select('*')
      .single();

    if (error) {
      return c.json({
        success: false,
        error: { code: 'DB_ERROR', message: error.message },
      }, 500);
    }

    return c.json({ success: true, data: { step: data } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'UPDATE_STEP_ERROR', message } }, 500);
  }
});

// Type guards
interface CreateSequenceRequest {
  name: string;
  target_grade: string;
  description?: string;
  is_active?: boolean;
}

function isCreateSequenceRequest(value: unknown): value is CreateSequenceRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return typeof obj['name'] === 'string' && typeof obj['target_grade'] === 'string';
}

interface CreateStepRequest {
  step_number: number;
  delay_days: number;
  purpose: string;
  tone?: string;
  key_message?: string;
  personalization_focus?: string;
  skip_if?: Record<string, unknown>;
  upgrade_if?: Record<string, unknown>;
}

function isCreateStepRequest(value: unknown): value is CreateStepRequest {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['step_number'] === 'number' &&
    typeof obj['delay_days'] === 'number' &&
    typeof obj['purpose'] === 'string'
  );
}

export default app;
