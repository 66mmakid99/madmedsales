import { Hono } from 'hono';
import { cors } from 'hono/cors';
import hospitalsRoute from './routes/hospitals.js';
import scoringRoute from './routes/scoring.js';
import demosRoute from './routes/demos';
import publicRoute from './routes/public';
import reportsRoute from './routes/reports';
import costsRoute from './routes/costs';
import networksRoute from './routes/networks';
import crmRoute from './routes/crm/index';
import emailsRoute from './routes/emails';
import sequencesRoute from './routes/sequences';
import webhooksRoute from './routes/webhooks';
import kakaoRoute from './routes/kakao';
import { processEmailQueue } from './services/email/queue';
import { processAllTriggers } from './services/automation/trigger-engine';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  RESEND_WEBHOOK_SECRET: string;
  KAKAO_API_KEY: string;
  KAKAO_SENDER_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS
app.use('*', cors({
  origin: (origin, c) => {
    // 로컬 개발 환경: localhost 모든 포트 허용
    if (origin && new URL(origin).hostname === 'localhost') {
      return origin;
    }
    const allowed = [
      c.env.ADMIN_URL,
      c.env.WEB_URL,
      'https://admin.madmedsales.com',
      'https://madmedsales.pages.dev',
    ];
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Error handler
app.onError((err, c) => {
  console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message, err.stack);
  return c.json({ success: false, error: { code: 'INTERNAL_ERROR', message: err.message } }, 500);
});

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));


// Routes
// Phase 1: Hospitals
app.route('/api/hospitals', hospitalsRoute);
// Phase 2: Scoring
app.route('/api/scoring', scoringRoute);
// Phase 3: Email Automation
app.route('/api/emails', emailsRoute);
app.route('/api/sequences', sequencesRoute);
// Phase 4: Webhooks, KakaoTalk (no auth on webhooks/public)
app.route('/api/webhooks', webhooksRoute);
app.route('/api/kakao', kakaoRoute);

// Phase 5: Demos & Public
app.route('/api/demos', demosRoute);
app.route('/api/public', publicRoute);
app.route('/api/reports', reportsRoute);
// Cost tracking
app.route('/api/costs', costsRoute);
// Network verification
app.route('/api/networks', networksRoute);
// CRM
app.route('/api/crm', crmRoute);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Bindings): Promise<void> {
    try {
      // Process email queue (every 5 min during send hours)
      const queueResult = await processEmailQueue(env);

      // Process triggers (hourly)
      const triggerResult = await processAllTriggers(env);

      // eslint-disable-next-line no-console
      console.log(
        `Scheduled: emails sent=${queueResult.sent} failed=${queueResult.failed}, ` +
        `triggers processed=${triggerResult.processed} actions=${triggerResult.actionsExecuted}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      // eslint-disable-next-line no-console
      console.error(`Scheduled handler error: ${message}`);
    }
  },
};
