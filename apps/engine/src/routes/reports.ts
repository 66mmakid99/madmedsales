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

// GET /dashboard/stats — 대시보드 통합 통계
app.get('/dashboard/stats', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const monthStart = now.toISOString().slice(0, 7) + '-01T00:00:00';

    const [
      hospitalTotal,
      profiledResult,
      equipHospitals,
      treatHospitals,
      priceHospitals,
      crawlsWeek,
      recentCrawls,
      gradeDistribution,
      profileGrades,
      leadsResult,
      costResult,
    ] = await Promise.all([
      supabase.from('hospitals').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('hospital_profiles').select('hospital_id', { count: 'exact', head: true }),
      supabase.from('hospital_equipments').select('hospital_id'),
      supabase.from('hospital_treatments').select('hospital_id'),
      supabase.from('hospital_pricing').select('hospital_id'),
      supabase.from('crawl_snapshots').select('id', { count: 'exact', head: true }).gte('crawled_at', weekAgo),
      supabase.from('crawl_snapshots')
        .select('id, hospital_id, crawled_at, tier, equipments_found, treatments_found, pricing_found, diff_summary')
        .order('crawled_at', { ascending: false })
        .limit(10),
      supabase.from('product_match_scores').select('grade'),
      supabase.from('hospital_profiles').select('hospital_id, profile_grade, profile_score, analyzed_at'),
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('api_usage_logs')
        .select('provider, estimated_cost')
        .gte('created_at', monthStart),
    ]);

    const totalHospitals = hospitalTotal.count ?? 0;
    const profiledCount = profiledResult.count ?? 0;
    const pendingCrawl = totalHospitals - profiledCount;

    const equipHospitalIds = new Set((equipHospitals.data ?? []).map(r => r.hospital_id));
    const treatHospitalIds = new Set((treatHospitals.data ?? []).map(r => r.hospital_id));
    const priceHospitalIds = new Set((priceHospitals.data ?? []).map(r => r.hospital_id));

    // 매칭 등급 분포
    const matchGrades: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };
    for (const row of gradeDistribution.data ?? []) {
      const g = row.grade as string;
      if (g in matchGrades) matchGrades[g] = (matchGrades[g] ?? 0) + 1;
    }

    // 프로파일 등급 분포
    const profGrades: Record<string, number> = { PRIME: 0, HIGH: 0, MID: 0, LOW: 0 };
    for (const row of profileGrades.data ?? []) {
      const g = row.profile_grade as string;
      if (g && g in profGrades) profGrades[g] = (profGrades[g] ?? 0) + 1;
    }

    // 최근 활동 (프로파일링 완료 기반)
    const profileData = profileGrades.data ?? [];
    const profileHospitalIds = [...new Set(profileData.map(r => r.hospital_id))];
    const crawlData = recentCrawls.data ?? [];
    const crawlHospitalIds = [...new Set(crawlData.map(r => r.hospital_id))];
    const allIds = [...new Set([...profileHospitalIds, ...crawlHospitalIds])];

    let hospitalNames: Record<string, string> = {};
    if (allIds.length > 0) {
      const { data: hNames } = await supabase
        .from('hospitals')
        .select('id, name')
        .in('id', allIds);
      for (const h of hNames ?? []) {
        hospitalNames[h.id] = h.name;
      }
    }

    // 최근 활동 피드: 프로파일링 완료 + 크롤 완료 합산
    type ActivityItem = { type: string; hospital: string; hospitalId: string; detail: string; time: string };
    const activities: ActivityItem[] = [];

    for (const p of profileData) {
      activities.push({
        type: 'profile',
        hospital: hospitalNames[p.hospital_id] ?? '알 수 없음',
        hospitalId: p.hospital_id,
        detail: `${p.profile_grade ?? '?'}등급, ${p.profile_score ?? 0}점`,
        time: p.analyzed_at ?? '',
      });
    }

    for (const cr of crawlData) {
      const eqCnt = Array.isArray(cr.equipments_found) ? cr.equipments_found.length : 0;
      const trCnt = Array.isArray(cr.treatments_found) ? cr.treatments_found.length : 0;
      activities.push({
        type: 'crawl',
        hospital: hospitalNames[cr.hospital_id] ?? '알 수 없음',
        hospitalId: cr.hospital_id,
        detail: `장비 ${eqCnt}개, 시술 ${trCnt}개 추출`,
        time: cr.crawled_at,
      });
    }
    activities.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

    const recentCrawlHistory = crawlData.map(r => ({
      id: r.id,
      hospitalName: hospitalNames[r.hospital_id] ?? '알 수 없음',
      hospitalId: r.hospital_id,
      crawledAt: r.crawled_at,
      tier: r.tier,
      equipmentsCount: Array.isArray(r.equipments_found) ? r.equipments_found.length : 0,
      treatmentsCount: Array.isArray(r.treatments_found) ? r.treatments_found.length : 0,
      pricingCount: Array.isArray(r.pricing_found) ? r.pricing_found.length : 0,
      diffSummary: r.diff_summary,
      status: 'success' as const,
    }));

    // 이번달 비용
    let geminiCost = 0;
    let claudeCost = 0;
    for (const row of costResult.data ?? []) {
      const cost = Number(row.estimated_cost) || 0;
      if (row.provider === 'gemini') geminiCost += cost;
      else if (row.provider === 'claude') claudeCost += cost;
    }
    const totalCost = geminiCost + claudeCost;
    const budget = 1000000;

    return c.json({
      success: true,
      data: {
        kpi: {
          totalHospitals,
          profiledCount,
          pendingCrawl,
          weekCrawls: crawlsWeek.count ?? 0,
        },
        pipeline: {
          phase1_collected: totalHospitals,
          phase2_profiled: profiledCount,
          phase3_leads: leadsResult.count ?? 0,
          phase4_contacted: 0,
          phase5_responded: 0,
          phase6_contracted: 0,
        },
        dataCollection: {
          totalHospitals,
          withEquipment: { count: equipHospitalIds.size, percentage: totalHospitals > 0 ? Math.round((equipHospitalIds.size / totalHospitals) * 100) : 0 },
          withTreatment: { count: treatHospitalIds.size, percentage: totalHospitals > 0 ? Math.round((treatHospitalIds.size / totalHospitals) * 100) : 0 },
          withPricing: { count: priceHospitalIds.size, percentage: totalHospitals > 0 ? Math.round((priceHospitalIds.size / totalHospitals) * 100) : 0 },
        },
        gradeDistribution: matchGrades,
        profileGradeDistribution: profGrades,
        recentActivity: activities.slice(0, 10),
        recentCrawls: recentCrawlHistory,
        monthlyCost: {
          gemini: Math.round(geminiCost),
          claude: Math.round(claudeCost),
          total: Math.round(totalCost),
          budget,
          percentage: budget > 0 ? Math.round((totalCost / budget) * 10000) / 100 : 0,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'DASHBOARD_STATS_ERROR', message } },
      500
    );
  }
});

// GET /dashboard/matches — 매칭 상세 내역 (영업전략 뷰)
app.get('/dashboard/matches', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    // 매칭 결과 + 병원/제품 JOIN
    const { data: matches, error } = await supabase
      .from('product_match_scores')
      .select('hospital_id, product_id, total_score, grade, sales_angle_scores, top_pitch_points, scored_at, scoring_version, hospitals(name, sido, sigungu, department), products(name)')
      .order('total_score', { ascending: false });

    if (error) {
      return c.json(
        { success: false, error: { code: 'DB_ERROR', message: error.message } },
        500
      );
    }

    // 해당 병원들의 프로파일 등급 조회
    const hospitalIds = [...new Set((matches ?? []).map(m => m.hospital_id))];
    let profileMap: Record<string, string> = {};
    if (hospitalIds.length > 0) {
      const { data: profiles } = await supabase
        .from('hospital_profiles')
        .select('hospital_id, profile_grade')
        .in('hospital_id', hospitalIds);
      for (const p of profiles ?? []) {
        profileMap[p.hospital_id] = p.profile_grade;
      }
    }

    // TORR RF의 sales_angles 정의 조회 (angle label 표시용)
    const { data: products } = await supabase
      .from('products')
      .select('id, scoring_criteria');

    type AngleMeta = { id: string; label: string; weight: number };
    const angleMetaByProduct: Record<string, AngleMeta[]> = {};
    for (const p of products ?? []) {
      const criteria = p.scoring_criteria as { sales_angles?: AngleMeta[] } | null;
      if (criteria?.sales_angles) {
        angleMetaByProduct[p.id] = criteria.sales_angles.map(a => ({
          id: a.id,
          label: a.label,
          weight: a.weight,
        }));
      }
    }

    const result = (matches ?? []).map(m => {
      const hospital = m.hospitals as unknown as { name: string; sido: string | null; sigungu: string | null; department: string | null } | null;
      const product = m.products as unknown as { name: string } | null;
      const angles = angleMetaByProduct[m.product_id] ?? [];
      const scores = (m.sales_angle_scores ?? {}) as Record<string, number>;

      return {
        hospitalId: m.hospital_id,
        hospitalName: hospital?.name ?? '알 수 없음',
        region: [hospital?.sido, hospital?.sigungu].filter(Boolean).join(' ') || null,
        department: hospital?.department ?? null,
        productName: product?.name ?? '알 수 없음',
        profileGrade: profileMap[m.hospital_id] ?? null,
        matchGrade: m.grade,
        totalScore: m.total_score,
        topPitchPoints: m.top_pitch_points ?? [],
        scoringVersion: m.scoring_version,
        scoredAt: m.scored_at,
        angleBreakdown: angles.map(a => ({
          id: a.id,
          label: a.label,
          weight: a.weight,
          score: scores[a.id] ?? 0,
          weightedScore: Math.round((scores[a.id] ?? 0) * a.weight / 100),
        })),
      };
    });

    return c.json({ success: true, data: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      { success: false, error: { code: 'MATCHES_ERROR', message } },
      500
    );
  }
});

// ── 크롤 관리 엔드포인트 ──

app.get('/crawls/stats', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const monthStart = new Date().toISOString().slice(0, 7) + '-01T00:00:00';

    const [totalResult, costResult] = await Promise.all([
      supabase.from('crawl_snapshots').select('id', { count: 'exact', head: true }),
      supabase.from('api_usage_logs')
        .select('estimated_cost')
        .eq('provider', 'gemini')
        .gte('created_at', monthStart),
    ]);

    const totalCrawls = totalResult.count ?? 0;
    const totalCost = (costResult.data ?? []).reduce((sum, r) => sum + (Number(r.estimated_cost) || 0), 0);

    return c.json({
      success: true,
      data: {
        totalCrawls,
        successCount: totalCrawls,
        failCount: 0,
        avgDuration: '-',
        totalCost: Math.round(totalCost),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CRAWL_STATS_ERROR', message } }, 500);
  }
});

app.get('/crawls', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const page = Number(c.req.query('page') ?? '1');
    const limit = Math.min(Number(c.req.query('limit') ?? '20'), 100);
    const offset = (page - 1) * limit;

    const { data: crawls, count } = await supabase
      .from('crawl_snapshots')
      .select('id, hospital_id, crawled_at, tier, equipments_found, treatments_found, pricing_found, diff_summary', { count: 'exact' })
      .order('crawled_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const crawlData = crawls ?? [];
    const hospitalIds = [...new Set(crawlData.map(r => r.hospital_id))];
    let names: Record<string, string> = {};
    if (hospitalIds.length > 0) {
      const { data: hNames } = await supabase.from('hospitals').select('id, name').in('id', hospitalIds);
      for (const h of hNames ?? []) names[h.id] = h.name;
    }

    const total = count ?? 0;
    const result = crawlData.map(r => ({
      id: r.id,
      hospitalName: names[r.hospital_id] ?? '알 수 없음',
      hospitalId: r.hospital_id,
      crawlDate: r.crawled_at,
      method: r.tier ?? 'firecrawl',
      equipmentCount: Array.isArray(r.equipments_found) ? r.equipments_found.length : 0,
      treatmentCount: Array.isArray(r.treatments_found) ? r.treatments_found.length : 0,
      pricingCount: Array.isArray(r.pricing_found) ? r.pricing_found.length : 0,
      status: 'success',
    }));

    return c.json({
      success: true,
      data: result,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'CRAWLS_ERROR', message } }, 500);
  }
});

export default app;
