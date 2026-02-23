import { Hono } from 'hono';
import type { Context } from 'hono';
import { createSupabaseClient } from '../lib/supabase.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY: string;
  ADMIN_URL: string;
  WEB_URL: string;
  SETTINGS_KV: KVNamespace;
};

const hospitals = new Hono<{ Bindings: Bindings }>();

// Sido alias map (DB에 "서울"/"서울특별시" 혼재 대응)
const SIDO_ALIASES: Record<string, string[]> = {
  '서울': ['서울', '서울특별시'], '서울특별시': ['서울', '서울특별시'],
  '경기': ['경기', '경기도'], '경기도': ['경기', '경기도'],
  '부산': ['부산', '부산광역시'], '부산광역시': ['부산', '부산광역시'],
  '대구': ['대구', '대구광역시'], '대구광역시': ['대구', '대구광역시'],
  '인천': ['인천', '인천광역시'], '인천광역시': ['인천', '인천광역시'],
  '광주': ['광주', '광주광역시'], '광주광역시': ['광주', '광주광역시'],
  '대전': ['대전', '대전광역시'], '대전광역시': ['대전', '대전광역시'],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase query builder generics are complex
function applySidoFilter<T extends { in: (col: string, vals: string[]) => T; eq: (col: string, val: string) => T }>(
  query: T,
  sido: string
): T {
  const aliases = SIDO_ALIASES[sido];
  return aliases ? query.in('sido', aliases) : query.eq('sido', sido);
}

// GET /summary - Hospital DB summary counts
hospitals.get('/summary', async (c) => {
  const supabase = createSupabaseClient(c.env);

  // 병렬 3개 쿼리: 전체 병원 수, 크롤 완료 병원 ID, 프로파일링 완료 병원 ID
  const [
    { count: totalCount },
    { data: crawledRows },
    { data: profiledRows },
  ] = await Promise.all([
    supabase.from('hospitals').select('id', { count: 'exact', head: true }),
    supabase.from('crawl_snapshots').select('hospital_id'),
    supabase.from('hospital_profiles').select('hospital_id'),
  ]);

  const crawledIds = new Set((crawledRows ?? []).map((r) => r.hospital_id));
  const profiledIds = new Set((profiledRows ?? []).map((r) => r.hospital_id));

  const profiled = profiledIds.size;
  const crawledOnly = [...crawledIds].filter((id) => !profiledIds.has(id)).length;
  const total = totalCount ?? 0;
  const uncollected = total - profiled - crawledOnly;

  return c.json({
    success: true,
    data: { total, profiled, crawledOnly, uncollected },
  });
});

// GET / - Hospital list with filters and pagination
hospitals.get('/', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const search = c.req.query('search');
  const sido = c.req.query('sido');
  const sigungu = c.req.query('sigungu');
  const department = c.req.query('department');
  const status = c.req.query('status');
  const minScore = c.req.query('min_score');
  const hasEmail = c.req.query('has_email');
  const hasEquipment = c.req.query('has_equipment');
  const profiled = c.req.query('profiled');
  const enrich = c.req.query('enrich');
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = (page - 1) * limit;

  // profiled=true: 프로파일링 완료 병원만 (hospital_profiles 존재)
  if (profiled === 'true') {
    return handleProfiledList(c, supabase, { search, sido, sigungu, department, page, limit, offset });
  }

  let query = supabase
    .from('hospitals')
    .select(
      'id, name, address, sido, sigungu, department, hospital_type, phone, email, website, data_quality_score, status, is_target, opened_at, created_at',
      { count: 'exact' }
    );

  if (search) query = query.ilike('name', `%${search}%`);
  if (sido) query = applySidoFilter(query, sido);
  if (sigungu) query = query.eq('sigungu', sigungu);
  if (department) query = query.eq('department', department);
  if (status) query = query.eq('status', status);
  if (minScore) query = query.gte('data_quality_score', parseInt(minScore, 10));
  if (hasEmail === 'true') query = query.not('email', 'is', null);
  if (hasEmail === 'false') query = query.is('email', null);

  query = query.order('data_quality_score', { ascending: false }).range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  // Filter by equipment presence if requested
  let filteredData = data ?? [];
  if (hasEquipment === 'true' || hasEquipment === 'false') {
    const hospitalIds = filteredData.map((h) => h.id);
    if (hospitalIds.length > 0) {
      const { data: equipHospitals } = await supabase
        .from('hospital_equipments')
        .select('hospital_id')
        .in('hospital_id', hospitalIds);

      const withEquipIds = new Set(
        (equipHospitals ?? []).map((e) => e.hospital_id)
      );

      filteredData =
        hasEquipment === 'true'
          ? filteredData.filter((h) => withEquipIds.has(h.id))
          : filteredData.filter((h) => !withEquipIds.has(h.id));
    }
  }

  // enrich=true: 프로파일링 여부 표시 (전체 병원 탭용)
  let enrichedData = filteredData;
  if (enrich === 'true' && filteredData.length > 0) {
    const hospitalIds = filteredData.map((h) => h.id);
    const { data: profileRows } = await supabase
      .from('hospital_profiles')
      .select('hospital_id')
      .in('hospital_id', hospitalIds);
    const profiledSet = new Set((profileRows ?? []).map((r) => r.hospital_id));
    enrichedData = filteredData.map((h) => ({
      ...h,
      is_profiled: profiledSet.has(h.id),
    }));
  }

  return c.json({
    success: true,
    data: enrichedData,
    pagination: {
      page,
      limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / limit),
    },
  });
});

// Handler: profiled hospital list with aggregated counts
async function handleProfiledList(
  c: Context<{ Bindings: Bindings }>,
  supabase: ReturnType<typeof createSupabaseClient>,
  opts: {
    search: string | undefined;
    sido: string | undefined;
    sigungu: string | undefined;
    department: string | undefined;
    page: number;
    limit: number;
    offset: number;
  },
): Promise<Response> {
  // 1) 프로파일링된 병원 ID 조회
  const { data: profileRows } = await supabase
    .from('hospital_profiles')
    .select('hospital_id, profile_grade');

  if (!profileRows || profileRows.length === 0) {
    return c.json({
      success: true,
      data: [],
      pagination: { page: opts.page, limit: opts.limit, total: 0, totalPages: 0 },
    });
  }

  const profiledIds = profileRows.map((r) => r.hospital_id);
  const gradeMap = new Map(profileRows.map((r) => [r.hospital_id, r.profile_grade]));

  // 2) 해당 병원 기본 정보 (필터 적용)
  let query = supabase
    .from('hospitals')
    .select(
      'id, name, address, sido, sigungu, department, hospital_type, phone, email, website, data_quality_score, status, is_target, created_at',
      { count: 'exact' }
    )
    .in('id', profiledIds);

  if (opts.search) query = query.ilike('name', `%${opts.search}%`);
  if (opts.sido) query = applySidoFilter(query, opts.sido);
  if (opts.sigungu) query = query.eq('sigungu', opts.sigungu);
  if (opts.department) query = query.eq('department', opts.department);

  query = query.order('data_quality_score', { ascending: false })
    .range(opts.offset, opts.offset + opts.limit - 1);

  const { data: hospitalData, error, count } = await query;

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  const hospitals_ = hospitalData ?? [];
  if (hospitals_.length === 0) {
    return c.json({
      success: true,
      data: [],
      pagination: { page: opts.page, limit: opts.limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / opts.limit) },
    });
  }

  const pageIds = hospitals_.map((h) => h.id);

  // 3) 병렬: 장비수, 시술수, 가격수, 매칭 최고등급, 마지막 크롤일
  const [
    { data: equipCounts },
    { data: treatCounts },
    { data: priceCounts },
    { data: matchRows },
    { data: crawlRows },
  ] = await Promise.all([
    supabase.from('hospital_equipments').select('hospital_id').in('hospital_id', pageIds),
    supabase.from('hospital_treatments').select('hospital_id').in('hospital_id', pageIds),
    supabase.from('hospital_pricing').select('hospital_id').in('hospital_id', pageIds),
    supabase.from('product_match_scores').select('hospital_id, grade').in('hospital_id', pageIds),
    supabase.from('crawl_snapshots').select('hospital_id, crawled_at').in('hospital_id', pageIds).order('crawled_at', { ascending: false }),
  ]);

  // 집계
  const countBy = (rows: { hospital_id: string }[] | null): Map<string, number> => {
    const map = new Map<string, number>();
    for (const r of rows ?? []) {
      map.set(r.hospital_id, (map.get(r.hospital_id) ?? 0) + 1);
    }
    return map;
  };

  const equipMap = countBy(equipCounts);
  const treatMap = countBy(treatCounts);
  const priceMap = countBy(priceCounts);

  // 매칭 최고 등급
  const GRADE_ORDER: Record<string, number> = { S: 0, A: 1, B: 2, C: 3 };
  const bestMatchGrade = new Map<string, string>();
  for (const r of matchRows ?? []) {
    const current = bestMatchGrade.get(r.hospital_id);
    if (!current || (GRADE_ORDER[r.grade ?? 'C'] ?? 3) < (GRADE_ORDER[current] ?? 3)) {
      bestMatchGrade.set(r.hospital_id, r.grade ?? 'C');
    }
  }

  // 마지막 크롤일 (이미 정렬됨)
  const lastCrawlMap = new Map<string, string>();
  for (const r of crawlRows ?? []) {
    if (!lastCrawlMap.has(r.hospital_id)) {
      lastCrawlMap.set(r.hospital_id, r.crawled_at);
    }
  }

  const enriched = hospitals_.map((h) => ({
    ...h,
    profile_grade: gradeMap.get(h.id) ?? null,
    equipment_count: equipMap.get(h.id) ?? 0,
    treatment_count: treatMap.get(h.id) ?? 0,
    pricing_count: priceMap.get(h.id) ?? 0,
    best_match_grade: bestMatchGrade.get(h.id) ?? null,
    last_crawled_at: lastCrawlMap.get(h.id) ?? null,
  }));

  return c.json({
    success: true,
    data: enriched,
    pagination: {
      page: opts.page,
      limit: opts.limit,
      total: count ?? 0,
      totalPages: Math.ceil((count ?? 0) / opts.limit),
    },
  });
}

// GET /stats - Statistics
hospitals.get('/stats', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const { data: byRegion, error: regionErr } = await supabase
    .from('hospitals')
    .select('sido')
    .eq('status', 'active');

  if (regionErr) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: regionErr.message } },
      500
    );
  }

  const regionCounts: Record<string, number> = {};
  for (const h of byRegion ?? []) {
    const key = h.sido ?? 'unknown';
    regionCounts[key] = (regionCounts[key] ?? 0) + 1;
  }

  const { data: byDept, error: deptErr } = await supabase
    .from('hospitals')
    .select('department')
    .eq('status', 'active');

  if (deptErr) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: deptErr.message } },
      500
    );
  }

  const deptCounts: Record<string, number> = {};
  for (const h of byDept ?? []) {
    const key = h.department ?? 'unknown';
    deptCounts[key] = (deptCounts[key] ?? 0) + 1;
  }

  const { count: totalCount } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active');

  const { count: emailCount } = await supabase
    .from('hospitals')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'active')
    .not('email', 'is', null);

  return c.json({
    success: true,
    data: {
      total: totalCount ?? 0,
      withEmail: emailCount ?? 0,
      byRegion: regionCounts,
      byDepartment: deptCounts,
    },
  });
});

// ── 프로파일 점수 산출 근거 헬퍼 ──
// 프로파일러(profiler.ts v3.1)와 동일한 로직으로 항목별 배점을 재현
const PREMIUM_EQUIP_NAMES = ['울쎄라', '써마지', '피코슈어', '쿨스컬프팅', '인모드', '포텐자', '슈링크', '볼뉴머', '프로파운드'];
const ALL_CATEGORIES = ['RF', 'HIFU', '레이저', '리프팅', '바디', '부스터', '스킨케어'];

interface ScoreLineItem {
  label: string;
  value: string;
  points: number;
  maxPoints: number;
}

interface AxisBreakdown {
  axisLabel: string;
  weight: number;
  totalScore: number;
  weightedScore: number;
  items: ScoreLineItem[];
}

type ScoreBreakdown = AxisBreakdown[];

function buildScoreBreakdown(
  equipments: { equipment_name: string; equipment_category: string | null; estimated_year: number | null }[],
  treatments: { treatment_category: string | null; price_min: number | null; price_max: number | null }[],
  hospital: { opened_at?: string | null; website?: string | null; email?: string | null; data_quality_score?: number },
  doctors: { name: string; title: string | null; specialty: string | null }[],
): ScoreBreakdown {
  const currentYear = new Date().getFullYear();

  // ── 축1: 투자성향 (35%) ──
  // 최신장비 도입 데이터(estimated_year)가 없으므로 비활성 (0점)
  const recentEquip = equipments.filter(e => e.estimated_year != null && currentYear - (e.estimated_year as number) <= 2);
  const recentRatio = equipments.length > 0 ? recentEquip.length / equipments.length : 0;
  const recentPt = 0; // 데이터 수집 전까지 비활성

  const premiumMatched = equipments.filter(e => PREMIUM_EQUIP_NAMES.some(p => e.equipment_name?.includes(p)));
  const premiumNames = [...new Set(premiumMatched.map(e => e.equipment_name))];
  let premiumPt = 0;
  if (premiumMatched.length >= 5) premiumPt = 55;
  else if (premiumMatched.length >= 4) premiumPt = 48;
  else if (premiumMatched.length >= 3) premiumPt = 40;
  else if (premiumMatched.length >= 2) premiumPt = 30;
  else if (premiumMatched.length >= 1) premiumPt = 18;

  let openedYears: number | null = null;
  let openedPt = 0;
  if (hospital.opened_at) {
    openedYears = currentYear - new Date(hospital.opened_at).getFullYear();
    if (openedYears >= 2 && openedYears <= 5) openedPt = 45;
    else if (openedYears >= 6 && openedYears <= 10) openedPt = 33;
    else if (openedYears > 10) openedPt = 22;
    else if (openedYears >= 1) openedPt = 15;
  }
  const investTotal = Math.min(premiumPt + openedPt, 100);

  // ── 축2: 포트폴리오 (25%) ──
  const categories = [...new Set(equipments.map(e => e.equipment_category).filter((c): c is string => c != null))];
  const coverageRatio = categories.length / ALL_CATEGORIES.length;
  const catPt = Math.round(coverageRatio * 50);

  let eqCountPt = 0;
  if (equipments.length >= 10) eqCountPt = 20;
  else if (equipments.length >= 7) eqCountPt = 16;
  else if (equipments.length >= 5) eqCountPt = 12;
  else if (equipments.length >= 3) eqCountPt = 8;
  else if (equipments.length >= 1) eqCountPt = 4;

  let trCountPt = 0;
  if (treatments.length >= 20) trCountPt = 30;
  else if (treatments.length >= 15) trCountPt = 25;
  else if (treatments.length >= 10) trCountPt = 18;
  else if (treatments.length >= 5) trCountPt = 12;
  else if (treatments.length >= 1) trCountPt = 5;
  const portfolioTotal = Math.min(catPt + eqCountPt + trCountPt, 100);

  // ── 축3: 규모신뢰 (25%) ──
  const doctorCount = doctors.length;
  let doctorPt = 0;
  if (doctorCount >= 5) doctorPt = 40;
  else if (doctorCount >= 3) doctorPt = 32;
  else if (doctorCount >= 2) doctorPt = 22;
  else if (doctorCount >= 1) doctorPt = 12;

  const prices = treatments.map(t => t.price_min).filter((p): p is number => p != null && p > 0);
  const avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : null;
  let pricePt = 0;
  if (avgPrice != null) {
    if (avgPrice >= 500000) pricePt = 35;
    else if (avgPrice >= 300000) pricePt = 28;
    else if (avgPrice >= 150000) pricePt = 20;
    else if (avgPrice >= 80000) pricePt = 12;
  }

  const premiumCats = ['리프팅', '성형'];
  const premiumTreatCount = treatments.filter(t => t.treatment_category != null && premiumCats.includes(t.treatment_category)).length;
  const premiumRatio = treatments.length > 0 ? premiumTreatCount / treatments.length : 0;
  let premiumTrPt = 0;
  if (premiumRatio >= 0.4) premiumTrPt = 25;
  else if (premiumRatio >= 0.2) premiumTrPt = 18;
  else if (premiumRatio > 0) premiumTrPt = 10;

  // ── 축4: 마케팅 (15%) ──
  const websiteBonus = hospital.website ? 5 : 0;
  const emailBonus = hospital.email ? 3 : 0;
  const marketingTotal = Math.min(websiteBonus + emailBonus, 100);

  return [
    {
      axisLabel: '투자성향',
      weight: 35,
      totalScore: investTotal,
      weightedScore: Math.round(investTotal * 0.35),
      items: [
        {
          label: '프리미엄 장비 보유',
          value: premiumNames.length > 0 ? `${premiumNames.length}대: ${premiumNames.join(', ')}` : '없음',
          points: premiumPt,
          maxPoints: 55,
        },
        {
          label: '개원 연차',
          value: openedYears != null ? `${openedYears}년차` : '미상',
          points: openedPt,
          maxPoints: 45,
        },
        {
          label: '최신장비 도입률 (2년내)',
          value: recentEquip.length > 0 ? `${recentEquip.length}대 / ${equipments.length}대 (${Math.round(recentRatio * 100)}%)` : '데이터 수집 예정',
          points: recentPt,
          maxPoints: 0,
        },
      ],
    },
    {
      axisLabel: '포트폴리오',
      weight: 25,
      totalScore: portfolioTotal,
      weightedScore: Math.round(portfolioTotal * 0.25),
      items: [
        {
          label: '장비 카테고리 다양성',
          value: `${categories.length}/${ALL_CATEGORIES.length}개${categories.length > 0 ? ': ' + categories.join(', ') : ''}`,
          points: catPt,
          maxPoints: 50,
        },
        {
          label: '총 장비 수',
          value: `${equipments.length}종`,
          points: eqCountPt,
          maxPoints: 20,
        },
        {
          label: '총 시술 메뉴 수',
          value: `${treatments.length}종`,
          points: trCountPt,
          maxPoints: 30,
        },
      ],
    },
    {
      axisLabel: '규모·신뢰',
      weight: 25,
      totalScore: Math.min(doctorPt + pricePt + premiumTrPt, 100),
      weightedScore: Math.round(Math.min(doctorPt + pricePt + premiumTrPt, 100) * 0.25),
      items: [
        {
          label: '의료진 수',
          value: doctorCount > 0
            ? `${doctorCount}명: ${doctors.map(d => `${d.name}${d.title ? `(${d.title})` : ''}${d.specialty ? ` — ${d.specialty}` : ''}`).join(', ')}`
            : '의료진 정보 없음',
          points: doctorPt,
          maxPoints: 40,
        },
        {
          label: '평균 시술 가격',
          value: avgPrice != null ? `${avgPrice.toLocaleString()}원 (${prices.length}건 기준)` : `가격 데이터 없음`,
          points: pricePt,
          maxPoints: 35,
        },
        {
          label: '프리미엄 시술 비중',
          value: `${premiumTreatCount}/${treatments.length}종 (${Math.round(premiumRatio * 100)}%)`,
          points: premiumTrPt,
          maxPoints: 25,
        },
      ],
    },
    {
      axisLabel: '마케팅',
      weight: 15,
      totalScore: marketingTotal,
      weightedScore: Math.round(marketingTotal * 0.15),
      items: [
        {
          label: '블로그 게시물',
          value: '네이버 API / fallback 추정치',
          points: 0,
          maxPoints: 40,
        },
        {
          label: '카페 게시물',
          value: '네이버 API / fallback 추정치',
          points: 0,
          maxPoints: 30,
        },
        {
          label: '뉴스 게시물',
          value: '네이버 API / fallback 추정치',
          points: 0,
          maxPoints: 30,
        },
        {
          label: '웹사이트 보너스',
          value: hospital.website ? '있음' : '없음',
          points: websiteBonus,
          maxPoints: 5,
        },
        {
          label: '이메일 보너스',
          value: hospital.email ? '있음' : '없음',
          points: emailBonus,
          maxPoints: 3,
        },
      ],
    },
  ];
}

// GET /:id - Hospital detail with equipments, treatments, profile, matches, pricing, crawl history
hospitals.get('/:id', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const id = c.req.param('id');

  const { data: hospital, error } = await supabase
    .from('hospitals')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !hospital) {
    return c.json(
      {
        success: false,
        error: { code: 'HOSPITAL_NOT_FOUND', message: '해당 병원을 찾을 수 없습니다.' },
      },
      404
    );
  }

  const [
    { data: equipments },
    { data: treatments },
    { data: doctors },
    { data: profile },
    { data: matchScoresRaw },
    { data: pricing },
    { data: crawlHistory },
  ] = await Promise.all([
    supabase
      .from('hospital_equipments')
      .select('id, equipment_name, equipment_brand, equipment_category, equipment_model, estimated_year, is_confirmed, source')
      .eq('hospital_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('hospital_treatments')
      .select('id, treatment_name, treatment_category, price_min, price_max, is_promoted, source')
      .eq('hospital_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('hospital_doctors')
      .select('id, name, title, specialty')
      .eq('hospital_id', id),
    supabase
      .from('hospital_profiles')
      .select('investment_score, portfolio_diversity_score, practice_scale_score, marketing_activity_score, profile_score, profile_grade, ai_summary, main_focus, target_audience, analyzed_at')
      .eq('hospital_id', id)
      .maybeSingle(),
    supabase
      .from('product_match_scores')
      .select('product_id, total_score, grade, sales_angle_scores, top_pitch_points, scored_at, scoring_version, products(name)')
      .eq('hospital_id', id)
      .order('total_score', { ascending: false }),
    supabase
      .from('hospital_pricing')
      .select('treatment_name, standard_name, total_price, unit_price, unit_type, is_event_price, event_label, confidence_level, crawled_at')
      .eq('hospital_id', id)
      .order('crawled_at', { ascending: false })
      .limit(50),
    supabase
      .from('crawl_snapshots')
      .select('crawled_at, tier, equipments_found, treatments_found, pricing_found, diff_summary')
      .eq('hospital_id', id)
      .order('crawled_at', { ascending: false })
      .limit(10),
  ]);

  const matchScores = (matchScoresRaw ?? []).map((ms) => {
    const productRef = ms.products as unknown as { name: string } | null;
    return {
      product_id: ms.product_id,
      product_name: productRef?.name ?? '',
      total_score: ms.total_score,
      grade: ms.grade,
      sales_angle_scores: ms.sales_angle_scores,
      top_pitch_points: ms.top_pitch_points,
      scoring_version: ms.scoring_version,
      scored_at: ms.scored_at,
    };
  });

  const equipmentsList = equipments ?? [];
  const treatmentsList = treatments ?? [];
  const doctorsList = doctors ?? [];
  const pricingList = pricing ?? [];
  const crawlList = crawlHistory ?? [];

  // 프로파일 점수 산출 근거 계산
  const scoreBreakdown = profile ? buildScoreBreakdown(equipmentsList, treatmentsList, hospital, doctorsList) : null;

  return c.json({
    success: true,
    data: {
      ...hospital,
      equipments: equipmentsList,
      treatments: treatmentsList,
      profile: profile ?? null,
      scoreBreakdown,
      matchScores,
      pricing: pricingList,
      crawlHistory: crawlList,
      dataSummary: {
        equipmentCount: equipmentsList.length,
        treatmentCount: treatmentsList.length,
        pricingCount: pricingList.length,
        crawlCount: crawlList.length,
        lastCrawledAt: crawlList[0]?.crawled_at ?? null,
        profileGrade: profile?.profile_grade ?? null,
      },
    },
  });
});

// PUT /:id - Update hospital
hospitals.put('/:id', async (c) => {
  const supabase = createSupabaseClient(c.env);
  const id = c.req.param('id');

  const body: unknown = await c.req.json();
  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const allowedFields = [
    'name', 'address', 'address_detail', 'sido', 'sigungu', 'dong',
    'phone', 'email', 'website', 'doctor_name', 'doctor_specialty',
    'doctor_board', 'department', 'hospital_type', 'status', 'is_target',
    'exclude_reason', 'verified_at',
  ];

  const updates: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (allowedFields.includes(key)) {
      updates[key] = value;
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json(
      { success: false, error: { code: 'NO_UPDATES', message: '업데이트할 필드가 없습니다.' } },
      400
    );
  }

  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('hospitals')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  return c.json({ success: true, data });
});

// POST /search - Search hospitals
hospitals.post('/search', async (c) => {
  const supabase = createSupabaseClient(c.env);

  const body: unknown = await c.req.json();
  if (typeof body !== 'object' || body === null) {
    return c.json(
      { success: false, error: { code: 'INVALID_BODY', message: '유효하지 않은 요청입니다.' } },
      400
    );
  }

  const { query, limit: rawLimit } = body as { query?: string; limit?: number };

  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    return c.json(
      { success: false, error: { code: 'MISSING_QUERY', message: '검색어를 입력하세요.' } },
      400
    );
  }

  const searchLimit = Math.min(rawLimit ?? 20, 100);

  const { data, error } = await supabase
    .from('hospitals')
    .select('id, name, address, sido, sigungu, department, email, data_quality_score, status')
    .or(`name.ilike.%${query}%,address.ilike.%${query}%`)
    .eq('status', 'active')
    .limit(searchLimit);

  if (error) {
    return c.json(
      { success: false, error: { code: 'DB_ERROR', message: error.message } },
      500
    );
  }

  return c.json({ success: true, data: data ?? [] });
});

export default hospitals;
