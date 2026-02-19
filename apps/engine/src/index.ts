import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

// CORS
app.use('*', cors({
  origin: (origin, c) => {
    const allowed = [c.env.ADMIN_URL, c.env.WEB_URL];
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Routes (Phase별로 추가)
// Phase 1: app.route('/api/hospitals', hospitalsRoute);
// Phase 2: app.route('/api/scoring', scoringRoute);
// Phase 3: app.route('/api/emails', emailsRoute);
// Phase 4: app.route('/api/tracking', trackingRoute);
// Phase 5: app.route('/api/kakao', kakaoRoute);
// Phase 5: app.route('/api/demos', demosRoute);
// Phase 6: app.route('/api/reports', reportsRoute);

export default app;
