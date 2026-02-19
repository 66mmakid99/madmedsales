import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';

type Bindings = {
  ADMIN_URL: string;
  WEB_URL: string;
};

export const corsMiddleware: MiddlewareHandler<{ Bindings: Bindings }> = cors({
  origin: (origin, c) => {
    const allowed = [c.env.ADMIN_URL, c.env.WEB_URL];
    return allowed.includes(origin) ? origin : '';
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowHeaders: ['Content-Type', 'Authorization'],
});
