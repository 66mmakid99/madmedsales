import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { createSupabaseClient } from '../lib/supabase';
import { T } from '../lib/table-names';

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
      .from(T.leads)
      .select('id', { count: 'exact', head: true });

    const { count: todaySends } = await supabase
      .from(T.emails)
      .select('id', { count: 'exact', head: true })
      .gte('sent_at', `${today}T00:00:00`)
      .lte('sent_at', `${today}T23:59:59`);

    const { count: totalSent } = await supabase
      .from(T.emails)
      .select('id', { count: 'exact', head: true })
      .eq('status', 'sent');

    const { count: totalOpened } = await supabase
      .from(T.email_events)
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'opened');

    const openRate = totalSent && totalSent > 0 && totalOpened
      ? Math.round((totalOpened / totalSent) * 100)
      : 0;

    const { count: demosScheduled } = await supabase
      .from(T.demos)
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
      .from(T.leads)
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
      .from(T.lead_activities)
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
      .from(T.emails)
      .select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'delivered']);

    const { count: delivered } = await supabase
      .from(T.email_events)
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'delivered');

    const { count: opened } = await supabase
      .from(T.email_events)
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'opened');

    const { count: clicked } = await supabase
      .from(T.email_events)
      .select('id', { count: 'exact', head: true })
      .eq('event_type', 'clicked');

    const { count: replied } = await supabase
      .from(T.lead_activities)
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
      supabase.from(T.hospitals).select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from(T.hospital_profiles).select('hospital_id', { count: 'exact', head: true }),
      supabase.from(T.hospital_equipments).select('hospital_id'),
      supabase.from(T.hospital_treatments).select('hospital_id'),
      supabase.from(T.hospital_pricing).select('hospital_id'),
      supabase.from(T.crawl_snapshots).select('id', { count: 'exact', head: true }).gte('crawled_at', weekAgo),
      supabase.from(T.crawl_snapshots)
        .select('id, hospital_id, crawled_at, tier, equipments_found, treatments_found, pricing_found, diff_summary')
        .order('crawled_at', { ascending: false })
        .limit(10),
      supabase.from(T.product_match_scores).select('grade'),
      supabase.from(T.hospital_profiles).select('hospital_id, profile_grade, profile_score, analyzed_at'),
      supabase.from(T.leads).select('id', { count: 'exact', head: true }),
      supabase.from(T.api_usage_logs)
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
        .from(T.hospitals)
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
      .from(T.product_match_scores)
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
        .from(T.hospital_profiles)
        .select('hospital_id, profile_grade')
        .in('hospital_id', hospitalIds);
      for (const p of profiles ?? []) {
        profileMap[p.hospital_id] = p.profile_grade;
      }
    }

    // 해당 제품의 sales_angles 정의 조회 (angle label 표시용)
    const { data: products } = await supabase
      .from(T.products)
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

// GET /product/:productId — 제품별 성과 리포트
app.get('/product/:productId', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const productId = c.req.param('productId');

    const [productRes, matchRes, leadRes, emailRes, demoRes] = await Promise.all([
      supabase.from(T.products).select('id, name').eq('id', productId).single(),
      supabase.from(T.product_match_scores).select('grade, total_score').eq('product_id', productId),
      supabase.from(T.leads).select('id, stage, grade, interest_level').eq('product_id', productId),
      supabase.from(T.emails).select('id, status').eq('product_id', productId),
      supabase.from(T.demos).select('id, status').eq('product_id', productId),
    ]);

    if (productRes.error || !productRes.data) {
      return c.json({ success: false, error: { code: 'PRODUCT_NOT_FOUND', message: '제품을 찾을 수 없습니다.' } }, 404);
    }

    const matches = matchRes.data ?? [];
    const leads = leadRes.data ?? [];
    const emails = emailRes.data ?? [];
    const demos = demoRes.data ?? [];

    const matchGrades: Record<string, number> = { S: 0, A: 0, B: 0, C: 0 };
    for (const m of matches) {
      const g = m.grade as string;
      if (g in matchGrades) matchGrades[g]++;
    }

    const leadStages: Record<string, number> = {};
    for (const l of leads) {
      const s = l.stage as string;
      leadStages[s] = (leadStages[s] ?? 0) + 1;
    }

    const emailStats = { total: emails.length, sent: 0, pending: 0 };
    for (const e of emails) {
      if (e.status === 'sent' || e.status === 'delivered') emailStats.sent++;
      else if (e.status === 'pending' || e.status === 'queued') emailStats.pending++;
    }

    const demoStats = { total: demos.length, completed: 0, evaluated: 0 };
    for (const d of demos) {
      if (d.status === 'completed') demoStats.completed++;
      if (d.status === 'evaluated') demoStats.evaluated++;
    }

    const avgScore = matches.length > 0
      ? Math.round(matches.reduce((sum, m) => sum + (m.total_score as number), 0) / matches.length)
      : 0;

    return c.json({
      success: true,
      data: {
        product: productRes.data,
        matchCount: matches.length,
        avgMatchScore: avgScore,
        matchGrades,
        leadCount: leads.length,
        leadStages,
        emailStats,
        demoStats,
        conversionRate: leads.length > 0
          ? Math.round(((leadStages['closed_won'] ?? 0) / leads.length) * 100)
          : 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'PRODUCT_REPORT_ERROR', message } }, 500);
  }
});

// GET /revenue — 매출 파이프라인 리포트
app.get('/revenue', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);

    const [leadsRes, demosRes, emailsRes] = await Promise.all([
      supabase.from(T.leads).select('id, stage, grade, product_id, interest_level, updated_at'),
      supabase.from(T.demos).select('id, status, product_id'),
      supabase.from(T.emails).select('id, status, product_id'),
    ]);

    const leads = leadsRes.data ?? [];
    const demos = demosRes.data ?? [];
    const emails = emailsRes.data ?? [];

    // 제품별 리드 집계
    const byProduct: Record<string, { leads: number; hot: number; demos: number; emails: number; won: number }> = {};
    for (const l of leads) {
      const pid = l.product_id as string;
      if (!byProduct[pid]) byProduct[pid] = { leads: 0, hot: 0, demos: 0, emails: 0, won: 0 };
      byProduct[pid].leads++;
      if (l.interest_level === 'hot') byProduct[pid].hot++;
      if (l.stage === 'closed_won') byProduct[pid].won++;
    }
    for (const d of demos) {
      const pid = d.product_id as string;
      if (pid && byProduct[pid]) byProduct[pid].demos++;
    }
    for (const e of emails) {
      const pid = e.product_id as string;
      if (pid && byProduct[pid]) byProduct[pid].emails++;
    }

    // 주간 리드 추세 (최근 4주)
    const weeklyLeads: { week: string; count: number }[] = [];
    const now = new Date();
    for (let w = 3; w >= 0; w--) {
      const weekStart = new Date(now.getTime() - (w + 1) * 7 * 86400000);
      const weekEnd = new Date(now.getTime() - w * 7 * 86400000);
      const label = `${weekStart.getMonth() + 1}/${weekStart.getDate()}~`;
      const count = leads.filter((l) => {
        const d = new Date(l.updated_at);
        return d >= weekStart && d < weekEnd;
      }).length;
      weeklyLeads.push({ week: label, count });
    }

    // 제품명 조회
    const productIds = Object.keys(byProduct);
    let productNames: Record<string, string> = {};
    if (productIds.length > 0) {
      const { data: prods } = await supabase.from(T.products).select('id, name').in('id', productIds);
      for (const p of prods ?? []) productNames[p.id] = p.name;
    }

    const productSummary = Object.entries(byProduct).map(([pid, stats]) => ({
      productId: pid,
      productName: productNames[pid] ?? '알 수 없음',
      ...stats,
    }));

    return c.json({
      success: true,
      data: {
        totalLeads: leads.length,
        hotLeads: leads.filter((l) => l.interest_level === 'hot').length,
        closedWon: leads.filter((l) => l.stage === 'closed_won').length,
        totalDemos: demos.length,
        totalEmails: emails.length,
        productSummary,
        weeklyLeads,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'REVENUE_REPORT_ERROR', message } }, 500);
  }
});

// ── 영업 실시간 현황 ──

// GET /sales-status — 개별 영업건별 이메일 발송현황 (실시간 대시보드용)
app.get('/sales-status', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const stageFilter = c.req.query('stage'); // '' = 전체, 'active' = 활성만
    const gradeFilter = c.req.query('grade');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '200', 10), 500);

    // 1) 리드 + 병원 + 제품 조회
    let leadsQuery = supabase
      .from(T.leads)
      .select('id, grade, stage, interest_level, hospital_id, product_id, contact_email, updated_at, hospitals(name, sido, sigungu), products(name)')
      .order('updated_at', { ascending: false })
      .limit(limit);

    if (stageFilter === 'active') {
      leadsQuery = leadsQuery.not('stage', 'in', '("closed_won","closed_lost")');
    } else if (stageFilter) {
      leadsQuery = leadsQuery.eq('stage', stageFilter);
    }
    if (gradeFilter) {
      leadsQuery = leadsQuery.eq('grade', gradeFilter);
    }

    const { data: leads, error: leadsErr } = await leadsQuery;
    if (leadsErr) throw new Error(leadsErr.message);
    if (!leads || leads.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const leadIds = leads.map(l => l.id);

    // 2) 해당 리드들의 이메일 전체 조회 (발송일 역순)
    const { data: allEmails } = await supabase
      .from(T.emails)
      .select('id, lead_id, subject, status, sent_at, created_at')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false });

    const emails = allEmails ?? [];

    // 3) 이메일 이벤트 조회 (오픈/클릭)
    const emailIds = emails.map(e => e.id);
    const { data: allEvents } = emailIds.length > 0
      ? await supabase.from(T.email_events).select('email_id, event_type').in('email_id', emailIds)
      : { data: [] };

    // 4) 오늘의 KPI용 집계
    const today = new Date().toISOString().slice(0, 10);

    // 5) 맵 구성
    // 리드별 최신 이메일
    const latestByLead: Record<string, typeof emails[0]> = {};
    // 리드별 이메일 총 발송 수
    const countByLead: Record<string, number> = {};
    for (const email of emails) {
      if (!latestByLead[email.lead_id]) latestByLead[email.lead_id] = email;
      countByLead[email.lead_id] = (countByLead[email.lead_id] ?? 0) + 1;
    }

    // 이메일별 이벤트 셋
    const eventsByEmail: Record<string, Set<string>> = {};
    for (const ev of allEvents ?? []) {
      if (!eventsByEmail[ev.email_id]) eventsByEmail[ev.email_id] = new Set();
      eventsByEmail[ev.email_id].add(ev.event_type as string);
    }

    // 6) 결과 조립
    const result = leads.map(lead => {
      const hospital = lead.hospitals as unknown as { name: string; sido: string | null; sigungu: string | null } | null;
      const product = lead.products as unknown as { name: string } | null;
      const latestEmail = latestByLead[lead.id] ?? null;
      const evSet = latestEmail ? (eventsByEmail[latestEmail.id] ?? new Set()) : new Set();

      // 이메일 현황 요약
      let emailStatus: 'none' | 'queued' | 'sent' | 'opened' | 'clicked' | 'bounced' = 'none';
      if (latestEmail) {
        if (evSet.has('clicked')) emailStatus = 'clicked';
        else if (evSet.has('opened')) emailStatus = 'opened';
        else if (latestEmail.status === 'sent' || latestEmail.status === 'delivered') emailStatus = 'sent';
        else if (latestEmail.status === 'bounced' || latestEmail.status === 'failed') emailStatus = 'bounced';
        else emailStatus = 'queued';
      }

      return {
        leadId: lead.id,
        grade: lead.grade as string | null,
        stage: lead.stage as string,
        interestLevel: lead.interest_level as string | null,
        hospitalName: hospital?.name ?? '알 수 없음',
        region: [hospital?.sido, hospital?.sigungu].filter(Boolean).join(' ') || null,
        productName: product?.name ?? '알 수 없음',
        contactEmail: lead.contact_email as string | null,
        emailCount: countByLead[lead.id] ?? 0,
        emailStatus,
        latestEmail: latestEmail ? {
          id: latestEmail.id,
          subject: latestEmail.subject as string | null,
          status: latestEmail.status as string,
          sentAt: latestEmail.sent_at as string | null,
          opened: evSet.has('opened'),
          clicked: evSet.has('clicked'),
        } : null,
        updatedAt: lead.updated_at as string,
      };
    });

    // 7) KPI 요약
    const sentToday = result.filter(r => r.latestEmail?.sentAt?.startsWith(today)).length;
    const openedCount = result.filter(r => r.latestEmail?.opened).length;
    const clickedCount = result.filter(r => r.latestEmail?.clicked).length;
    const noEmailCount = result.filter(r => r.emailStatus === 'none').length;

    return c.json({
      success: true,
      data: {
        leads: result,
        kpi: {
          total: result.length,
          sentToday,
          opened: openedCount,
          clicked: clickedCount,
          noEmail: noEmailCount,
        },
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ success: false, error: { code: 'SALES_STATUS_ERROR', message } }, 500);
  }
});

// ── 크롤 관리 엔드포인트 ──

app.get('/crawls/stats', async (c) => {
  try {
    const supabase = createSupabaseClient(c.env);
    const monthStart = new Date().toISOString().slice(0, 7) + '-01T00:00:00';

    const [totalResult, costResult] = await Promise.all([
      supabase.from(T.crawl_snapshots).select('id', { count: 'exact', head: true }),
      supabase.from(T.api_usage_logs)
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
      .from(T.crawl_snapshots)
      .select('id, hospital_id, crawled_at, tier, equipments_found, treatments_found, pricing_found, diff_summary', { count: 'exact' })
      .order('crawled_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const crawlData = crawls ?? [];
    const hospitalIds = [...new Set(crawlData.map(r => r.hospital_id))];
    let names: Record<string, string> = {};
    if (hospitalIds.length > 0) {
      const { data: hNames } = await supabase.from(T.hospitals).select('id, name').in('id', hospitalIds);
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
