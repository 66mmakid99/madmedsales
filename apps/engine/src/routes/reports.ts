import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createSupabaseClient } from '../lib/supabase';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', authMiddleware);

app.get('/dashboard', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const today = new Date().toISOString().slice(0, 10);

    const { count: totalLeads } = await supabase
      .from('leads')
      .select('id', { count: 'exact', head: true });

    const { count: todaySends } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', `${today}T00:00:00`)
      .lte('sent_at', `${today}T23:59:59`);

    const { count: totalSent } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent');

    const { count: totalOpened } = await supabase
      .from('email_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'opened');

    const openRate = totalSent && totalSent > 0 && totalOpened
      ? Math.round((totalOpened / totalSent) * 100)
      : 0;

    const { count: demosScheduled } = await supabase
      .from('demos')
      .select('id', { count: 'exact', head: true })
      .in('status', ['requested', 'confirmed', 'preparing']);

    return c.json({
      success: true,
      data: {
        totalLeads: totalLeads ?? 0,
        todaySends: todaySends ?? 0,
        openRate,
        demosScheduled: demosScheduled ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DASHBOARD_ERROR', message } },
      500
    );
  }
});

app.get('/pipeline', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from('leads')
      .select('stage');

    if (error) {
      throw new Error(error.message);
    }

    const stages: Record<string, number> = {};
    for (const row of data ?? []) {
      const stage = row.stage as string;
      stages[stage] = (stages[stage] ?? 0) + 1;
    }

    return c.json({ success: true, data: { stages } });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'PIPELINE_ERROR', message } },
      500
    );
  }
});

app.get('/activities', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, lead_id, activity_type, title, description, actor, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      throw new Error(error.message);
    }

    return c.json({ success: true, data: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'ACTIVITIES_ERROR', message } },
      500
    );
  }
});

app.get('/email-stats', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const { count: sent } = await supabase
      .from('emails')
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'delivered']);

    const { count: delivered } = await supabase
      .from('email_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'delivered');

    const { count: opened } = await supabase
      .from('email_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'opened');

    const { count: clicked } = await supabase
      .from('email_events')
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'clicked');

    const { count: replied } = await supabase
      .from('lead_activities')
      .select('id', { count: 'exact', head: true })
      .eq('activity_type', 'email_replied');

    const sentCount = sent ?? 0;
    const deliveredCount = delivered ?? 0;
    const openedCount = opened ?? 0;
    const clickedCount = clicked ?? 0;
    const repliedCount = replied ?? 0;

    return c.json({
      success: true,
      data: {
        sent: sentCount,
        delivered: deliveredCount,
        opened: openedCount,
        clicked: clickedCount,
        replied: repliedCount,
        deliveryRate: sentCount > 0 ? Math.round((deliveredCount / sentCount) * 100) : 0,
        openRate: sentCount > 0 ? Math.round((openedCount / sentCount) * 100) : 0,
        clickRate: openedCount > 0 ? Math.round((clickedCount / openedCount) * 100) : 0,
        replyRate: sentCount > 0 ? Math.round((repliedCount / sentCount) * 100) : 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'EMAIL_STATS_ERROR', message } },
      500
    );
  }
});

export default app;
