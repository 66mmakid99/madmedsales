import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import {
  getDemos,
  getDemoById,
  confirmDemo,
  prepareDemoMaterials,
  completeDemo,
  cancelDemo,
} from '../services/demo/demo-service';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', authMiddleware);

app.get('/', async (c) => {
  try {
    const filters = {
      status: c.req.query('status'),
      lead_id: c.req.query('lead_id'),
      date_from: c.req.query('date_from'),
      date_to: c.req.query('date_to'),
      limit: c.req.query('limit'),
      offset: c.req.query('offset'),
    };

    const result = await getDemos(c.env, filters);
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DEMOS_FETCH_ERROR', message } },
      500
    );
  }
});

app.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await getDemoById(c.env, id);
    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message === 'DEMO_NOT_FOUND') {
      return c.json(
        { success: false, error: { code: 'DEMO_NOT_FOUND', message: '해당 데모를 찾을 수 없습니다.' } },
        404
      );
    }
    return c.json(
      { success: false, error: { code: 'DEMO_FETCH_ERROR', message } },
      500
    );
  }
});

app.put('/:id/confirm', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ scheduled_at: string }>();
    if (!body.scheduled_at) {
      return c.json(
        { success: false, error: { code: 'INVALID_INPUT', message: 'scheduled_at is required' } },
        400
      );
    }
    const demo = await confirmDemo(c.env, id, body.scheduled_at);
    return c.json({ success: true, data: demo });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DEMO_CONFIRM_ERROR', message } },
      500
    );
  }
});

app.put('/:id/prepare', async (c) => {
  try {
    const id = c.req.param('id');
    const demo = await prepareDemoMaterials(c.env, id);
    return c.json({ success: true, data: demo });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DEMO_PREPARE_ERROR', message } },
      500
    );
  }
});

app.put('/:id/complete', async (c) => {
  try {
    const id = c.req.param('id');
    const demo = await completeDemo(c.env, id);
    return c.json({ success: true, data: demo });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DEMO_COMPLETE_ERROR', message } },
      500
    );
  }
});

app.put('/:id/cancel', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ reason?: string }>().catch(() => ({}));
    const reason = 'reason' in body ? (body as { reason?: string }).reason : undefined;
    const demo = await cancelDemo(c.env, id, reason);
    return c.json({ success: true, data: demo });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DEMO_CANCEL_ERROR', message } },
      500
    );
  }
});

export default app;
