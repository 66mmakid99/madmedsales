import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createSupabaseClient } from '../lib/supabase';
import { MONTHLY_BUDGET_KRW, USD_TO_KRW } from '@madmedsales/shared/src/ai-cost.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const app = new Hono<{ Bindings: Bindings }>();

app.use('*', authMiddleware);

// GET /api/costs/summary — Total cost summary
app.get('/summary', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00`;

    const { data, error } = await supabase
      .from('api_usage_logs')
      .select('service, model, input_tokens, output_tokens, estimated_cost_usd')
      .gte('created_at', monthStart);

    if (error) throw new Error(error.message);

    const rows = data ?? [];

    let totalCostUsd = 0;
    let claudeCostUsd = 0;
    let geminiCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCalls = 0;
    const byModel: Record<string, { calls: number; costUsd: number }> = {};

    for (const row of rows) {
      const cost = Number(row.estimated_cost_usd) || 0;
      totalCostUsd += cost;
      totalInputTokens += row.input_tokens;
      totalOutputTokens += row.output_tokens;
      totalCalls++;

      if (row.service === 'claude') claudeCostUsd += cost;
      if (row.service === 'gemini') geminiCostUsd += cost;

      if (!byModel[row.model]) byModel[row.model] = { calls: 0, costUsd: 0 };
      byModel[row.model].calls++;
      byModel[row.model].costUsd += cost;
    }

    const totalCostKrw = Math.round(totalCostUsd * USD_TO_KRW);
    const budgetRemainingKrw = MONTHLY_BUDGET_KRW - totalCostKrw;

    return c.json({
      success: true,
      data: {
        totalCostUsd: Math.round(totalCostUsd * 1000000) / 1000000,
        totalCostKrw,
        claudeCostUsd: Math.round(claudeCostUsd * 1000000) / 1000000,
        geminiCostUsd: Math.round(geminiCostUsd * 1000000) / 1000000,
        totalInputTokens,
        totalOutputTokens,
        totalCalls,
        budgetKrw: MONTHLY_BUDGET_KRW,
        budgetRemainingKrw,
        budgetUsedPercent: Math.round((totalCostKrw / MONTHLY_BUDGET_KRW) * 100),
        byModel,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'COST_SUMMARY_ERROR', message } }, 500);
  }
});

// GET /api/costs/daily?days=30 — Daily cost breakdown
app.get('/daily', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const days = parseInt(c.req.query('days') ?? '30', 10);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startStr = startDate.toISOString().slice(0, 10) + 'T00:00:00';

    const { data, error } = await supabase
      .from('api_usage_logs')
      .select('service, estimated_cost_usd, created_at')
      .gte('created_at', startStr)
      .order('created_at', { ascending: true });

    if (error) throw new Error(error.message);

    const dailyMap: Record<string, { date: string; claude: number; gemini: number; total: number }> = {};

    for (const row of data ?? []) {
      const date = (row.created_at as string).slice(0, 10);
      if (!dailyMap[date]) dailyMap[date] = { date, claude: 0, gemini: 0, total: 0 };
      const cost = Number(row.estimated_cost_usd) || 0;
      dailyMap[date].total += cost;
      if (row.service === 'claude') dailyMap[date].claude += cost;
      if (row.service === 'gemini') dailyMap[date].gemini += cost;
    }

    const daily = Object.values(dailyMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        claude: Math.round(d.claude * 1000000) / 1000000,
        gemini: Math.round(d.gemini * 1000000) / 1000000,
        total: Math.round(d.total * 1000000) / 1000000,
        totalKrw: Math.round(d.total * USD_TO_KRW),
      }));

    return c.json({ success: true, data: daily });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'DAILY_COST_ERROR', message } }, 500);
  }
});

// GET /api/costs/by-purpose — Cost by purpose
app.get('/by-purpose', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00`;

    const { data, error } = await supabase
      .from('api_usage_logs')
      .select('purpose, estimated_cost_usd, input_tokens, output_tokens')
      .gte('created_at', monthStart);

    if (error) throw new Error(error.message);

    const purposeMap: Record<string, { purpose: string; calls: number; costUsd: number; inputTokens: number; outputTokens: number }> = {};

    for (const row of data ?? []) {
      if (!purposeMap[row.purpose]) {
        purposeMap[row.purpose] = { purpose: row.purpose, calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
      }
      const entry = purposeMap[row.purpose];
      entry.calls++;
      entry.costUsd += Number(row.estimated_cost_usd) || 0;
      entry.inputTokens += row.input_tokens;
      entry.outputTokens += row.output_tokens;
    }

    const purposes = Object.values(purposeMap).map((p) => ({
      ...p,
      costUsd: Math.round(p.costUsd * 1000000) / 1000000,
      costKrw: Math.round(p.costUsd * USD_TO_KRW),
    }));

    return c.json({ success: true, data: purposes });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'PURPOSE_COST_ERROR', message } }, 500);
  }
});

// GET /api/costs/budget — Budget status with projection
app.get('/budget', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01T00:00:00`;
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    const { data, error } = await supabase
      .from('api_usage_logs')
      .select('estimated_cost_usd')
      .gte('created_at', monthStart);

    if (error) throw new Error(error.message);

    let totalCostUsd = 0;
    for (const row of data ?? []) {
      totalCostUsd += Number(row.estimated_cost_usd) || 0;
    }

    const totalCostKrw = Math.round(totalCostUsd * USD_TO_KRW);
    const dailyAvgKrw = dayOfMonth > 0 ? totalCostKrw / dayOfMonth : 0;
    const projectedMonthEndKrw = Math.round(dailyAvgKrw * daysInMonth);
    const budgetRemainingKrw = MONTHLY_BUDGET_KRW - totalCostKrw;
    const usedPercent = Math.round((totalCostKrw / MONTHLY_BUDGET_KRW) * 100);

    return c.json({
      success: true,
      data: {
        budgetKrw: MONTHLY_BUDGET_KRW,
        usedKrw: totalCostKrw,
        remainingKrw: budgetRemainingKrw,
        usedPercent,
        projectedMonthEndKrw,
        projectedOverBudget: projectedMonthEndKrw > MONTHLY_BUDGET_KRW,
        dailyAvgKrw: Math.round(dailyAvgKrw),
        dayOfMonth,
        daysInMonth,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'BUDGET_ERROR', message } }, 500);
  }
});

export default app;
