/**
 * E2E 크롤러 테스트 — 10건 순차 실행
 *
 * 실행: npx tsx scripts/test-e2e-crawl.ts
 * 단일: npx tsx scripts/test-e2e-crawl.ts --index 1
 *
 * 전체 파이프라인: 크롤링 → DB저장 → 프로파일 → 매칭 → 시그널 → 보고
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ─── 테스트 대상 ──────────────────────────────────
interface TestTarget {
  index: number;
  name: string;
  url: string;
  difficulty: string;
  checkpoint: string;
}

const TARGETS: TestTarget[] = [
  { index: 1, name: '815의원', url: 'https://www.815clinic.co.kr/', difficulty: '🟢', checkpoint: '기본 PHP 크롤링' },
  { index: 2, name: '리멤버피부과', url: 'https://rememberno1.com/', difficulty: '🟢', checkpoint: '모던 사이트' },
  { index: 3, name: '고운세상피부과 명동', url: 'http://www.gowoonss.com/bbs/content.php?co_id=myungdong', difficulty: '🟡', checkpoint: 'PHP 게시판 구조' },
  { index: 4, name: '닥터스피부과 신사', url: 'https://www.doctors365.co.kr/branch/sinsa.php', difficulty: '🟡', checkpoint: '프랜차이즈 브랜치' },
  { index: 5, name: '한미인의원', url: 'https://hanmiin.kr/', difficulty: '🟡', checkpoint: '이미지 OCR 필요' },
  { index: 6, name: '제로피부과', url: 'https://www.zerodermaclinic.com/', difficulty: '🟡', checkpoint: '딥 서브페이지' },
  { index: 7, name: '톡스앤필 강서', url: 'https://www.toxnfill32.com/', difficulty: '🔴', checkpoint: '프랜차이즈 모바일퍼스트' },
  { index: 8, name: '이지함피부과 망우', url: 'http://mw.ljh.co.kr/', difficulty: '🔴', checkpoint: 'Wix SPA, JS 렌더링' },
  { index: 9, name: '바노바기피부과', url: 'https://www.skinbanobagi.com/web', difficulty: '🔴', checkpoint: '이미지 배너 + 팝업' },
  { index: 10, name: '신사루비의원', url: 'https://www.rubyclinic-sinsa.com/', difficulty: '🔴', checkpoint: '버튼/탭 인터랙션' },
];

// TORR RF 제품 ID (DB에 seed됨)
const TORR_RF_PRODUCT_ID = '5d35c712-228c-4835-acf6-904f6a8c342f';

// ─── 유틸 ───────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface HospitalReport {
  target: TestTarget;
  hospitalId: string | null;
  crawl: {
    status: 'success' | 'fail';
    error?: string;
    textLength: number;
    subpageCount: number;
    imageDownloaded: number;
    imageOcrCount: number;
    screenshotOcr: 'success' | 'fail' | 'skipped';
    screenshotOcrTextLength: number;
  };
  parsing: {
    equipments: string[];
    treatments: string[];
    prices: string[];
    doctorCount: number;
  };
  profiler: {
    score: number;
    grade: string;
    investment: number;
    portfolio: number;
    scaleTrust: number;
    marketing: number;
  } | null;
  matcher: {
    score: number;
    grade: string;
    angleDetails: Array<{ id: string; name: string; score: number; matchedKw: string[] }>;
    topPitchPoints: string[];
  } | null;
  signals: {
    equipmentChanges: number;
    salesSignals: string[];
  };
  apiCost: {
    geminiCalls: number;
    totalTokens: number;
  };
  durationMs: number;
}

// ─── STEP 1: 병원 등록/확인 ─────────────────────
async function ensureHospital(target: TestTarget): Promise<string> {
  // 이름으로 검색
  const { data: existing } = await supabase
    .from('hospitals')
    .select('id, website')
    .ilike('name', `%${target.name}%`)
    .limit(1)
    .single();

  if (existing) {
    // URL 업데이트
    if (existing.website !== target.url) {
      await supabase.from('hospitals').update({ website: target.url }).eq('id', existing.id);
    }
    return existing.id;
  }

  // 없으면 INSERT
  const { data: inserted, error } = await supabase
    .from('hospitals')
    .insert({
      name: target.name,
      website: target.url,
      status: 'ACTIVE',
      data_quality_score: 0,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    throw new Error(`Failed to insert hospital ${target.name}: ${error?.message}`);
  }

  return inserted.id;
}

// ─── STEP 2: 크롤링 파이프라인 실행 ─────────────
async function runCrawlPipeline(hospitalName: string): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const { execSync } = await import('child_process');
  const cmd = `npx tsx scripts/crawler/run-single-pipeline.ts --name "${hospitalName}"`;

  try {
    const stdout = execSync(cmd, {
      cwd: path.resolve(__dirname, '..'),
      timeout: 600000,  // 10분 (gemini-2.5-pro는 2.0-flash보다 느림)
      encoding: 'utf-8',
      env: { ...process.env, NODE_OPTIONS: '--no-warnings' },
    });
    return { exitCode: 0, stdout: stdout ?? '', stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message?: string };
    return {
      exitCode: e.status ?? 1,
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message ?? '',
    };
  }
}

// ─── STEP 3: 프로파일 + 매칭 실행 ───────────────
async function runProfileAndMatch(hospitalId: string): Promise<{
  profiler: HospitalReport['profiler'];
  matcher: HospitalReport['matcher'];
}> {
  // profiler와 matcher는 engine 서비스이므로 직접 import 불가 (경로 차이)
  // DB에서 데이터를 가져와서 순수 함수만 호출

  // ─── 프로파일링 ───
  const { data: hospital } = await supabase
    .from('hospitals')
    .select('id, name, opened_at, website, email, data_quality_score, latitude, longitude')
    .eq('id', hospitalId)
    .single();

  const { data: equipments } = await supabase
    .from('sales_hospital_equipments')
    .select('*')
    .eq('hospital_id', hospitalId);

  const { data: treatments } = await supabase
    .from('sales_hospital_treatments')
    .select('*')
    .eq('hospital_id', hospitalId);

  const { data: doctors } = await supabase
    .from('hospital_doctors')
    .select('id')
    .eq('hospital_id', hospitalId);

  const equips = equipments ?? [];
  const treats = treatments ?? [];
  const doctorCount = doctors?.length ?? 0;

  // v3.1 4축 직접 계산
  const currentYear = new Date().getFullYear();
  const PREMIUM = ['울쎄라', '써마지', '피코슈어', '쿨스컬프팅', '인모드', '슈링크', '올리지오'];

  // 투자 성향 (0~100)
  let investmentVal = 0;
  const total = equips.length;
  if (total >= 7) investmentVal += 30;
  else if (total >= 5) investmentVal += 25;
  else if (total >= 3) investmentVal += 18;
  else if (total >= 1) investmentVal += 10;
  const recentCount = equips.filter(
    (e: Record<string, unknown>) => e.estimated_year != null && currentYear - (e.estimated_year as number) <= 2
  ).length;
  if (recentCount >= 2) investmentVal += 30;
  else if (recentCount === 1) investmentVal += 20;
  const hasPremium = equips.some((e: Record<string, unknown>) =>
    PREMIUM.some((p) => (e.equipment_name as string).includes(p))
  );
  if (hasPremium) investmentVal += 25;
  const hasMultiPremium = equips.filter((e: Record<string, unknown>) =>
    PREMIUM.some((p) => (e.equipment_name as string).includes(p))
  ).length >= 2;
  if (hasMultiPremium) investmentVal += 15;
  investmentVal = Math.min(investmentVal, 100);

  // 포트폴리오 다양성 (0~100)
  const categories = new Set(equips.map((e: Record<string, unknown>) => e.equipment_category).filter(Boolean));
  let portfolioVal = Math.min(categories.size * 15, 50);
  const treatCategories = new Set(treats.map((t: Record<string, unknown>) => t.treatment_category).filter(Boolean));
  portfolioVal += Math.min(treatCategories.size * 10, 50);
  portfolioVal = Math.min(portfolioVal, 100);

  // 규모 및 신뢰 (0~100)
  let scaleTrustVal = 0;
  if (doctorCount >= 5) scaleTrustVal += 40;
  else if (doctorCount >= 3) scaleTrustVal += 30;
  else if (doctorCount >= 1) scaleTrustVal += 15;
  const treatCount = treats.length;
  if (treatCount >= 30) scaleTrustVal += 40;
  else if (treatCount >= 15) scaleTrustVal += 30;
  else if (treatCount >= 5) scaleTrustVal += 20;
  else if (treatCount >= 1) scaleTrustVal += 10;
  scaleTrustVal += Math.min(20, (hospital?.data_quality_score ?? 0) / 5);
  scaleTrustVal = Math.min(scaleTrustVal, 100);

  // 마케팅 (간소화 — website/email 존재 여부 기준)
  let marketingVal = 0;
  if (hospital?.website) marketingVal += 30;
  if (hospital?.email) marketingVal += 20;
  marketingVal += Math.min(50, (hospital?.data_quality_score ?? 0) / 2);
  marketingVal = Math.min(marketingVal, 100);

  const profileScore = Math.round(
    investmentVal * 0.35 + portfolioVal * 0.25 + scaleTrustVal * 0.25 + marketingVal * 0.15
  );

  const profileGrade =
    profileScore >= 80 ? 'PRIME' : profileScore >= 60 ? 'HIGH' : profileScore >= 40 ? 'MID' : 'LOW';

  // DB 저장
  await supabase.from('sales_hospital_profiles').upsert({
    hospital_id: hospitalId,
    investment_score: investmentVal,
    portfolio_diversity_score: portfolioVal,
    practice_scale_score: scaleTrustVal,
    marketing_activity_score: marketingVal,
    profile_score: profileScore,
    profile_grade: profileGrade,
    analyzed_at: new Date().toISOString(),
    analysis_version: 'v3.1-e2e',
  }, { onConflict: 'hospital_id' });

  const profilerResult = {
    score: profileScore,
    grade: profileGrade,
    investment: investmentVal,
    portfolio: portfolioVal,
    scaleTrust: scaleTrustVal,
    marketing: marketingVal,
  };

  // ─── 매칭 ───
  const { data: product } = await supabase
    .from('sales_products')
    .select('*')
    .eq('id', TORR_RF_PRODUCT_ID)
    .single();

  if (!product?.scoring_criteria) {
    return { profiler: profilerResult, matcher: null };
  }

  const criteria = product.scoring_criteria as {
    sales_angles: Array<{
      id: string;
      name: string;
      label?: string;
      weight: number;
      keywords: Array<{ term: string; tier: string; point: number } | string>;
    }>;
    exclude_if?: string[];
    max_pitch_points?: number;
  };

  // exclude_if 체크
  const isExcluded = (criteria.exclude_if ?? []).some((condition: string) => {
    const term = condition.replace('has_', '');
    return equips.some((e: Record<string, unknown>) =>
      (e.equipment_name as string).toLowerCase().includes(term.toLowerCase())
    );
  });

  if (isExcluded) {
    return {
      profiler: profilerResult,
      matcher: { score: 0, grade: 'EXCLUDE', angleDetails: [], topPitchPoints: [] },
    };
  }

  // sales_angles 평가
  const angleDetails: Array<{ id: string; name: string; score: number; matchedKw: string[] }> = [];
  const equipTexts = equips.map((e: Record<string, unknown>) => e.equipment_name as string);
  const treatTexts = treats.map((t: Record<string, unknown>) => t.treatment_name as string);
  const catTexts = treats.map((t: Record<string, unknown>) => t.treatment_category as string).filter(Boolean);
  const allTexts = [...equipTexts, ...treatTexts, ...catTexts];

  const totalWeight = criteria.sales_angles.reduce((sum, a) => sum + a.weight, 0);
  let weightedSum = 0;

  for (const angle of criteria.sales_angles) {
    const normalizedKws = angle.keywords.map((kw) => {
      if (typeof kw === 'string') return { term: kw, tier: 'secondary', point: 10 };
      return kw;
    });

    let matchedPoints = 0;
    let totalPoints = 0;
    const matchedKw: string[] = [];

    for (const kw of normalizedKws) {
      totalPoints += kw.point;
      const kwNorm = kw.term.replace(/\s+/g, '').toLowerCase();
      const matched = allTexts.some((t) => t.replace(/\s+/g, '').toLowerCase().includes(kwNorm));
      if (matched) {
        matchedPoints += kw.point;
        matchedKw.push(kw.term);
      }
    }

    const score = totalPoints > 0 ? Math.round((matchedPoints / totalPoints) * 100) : 0;
    const normalizedWeight = totalWeight > 0 ? angle.weight / totalWeight : 0;
    weightedSum += score * normalizedWeight;

    angleDetails.push({
      id: angle.id,
      name: angle.label ?? angle.name,
      score,
      matchedKw,
    });
  }

  const matchTotal = Math.round(weightedSum);
  const matchGrade = matchTotal >= 75 ? 'S' : matchTotal >= 55 ? 'A' : matchTotal >= 35 ? 'B' : 'C';
  const maxPitch = criteria.max_pitch_points ?? 2;
  const topPitchPoints = [...angleDetails]
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPitch)
    .map((d) => d.id);

  // DB 저장
  const angleScores: Record<string, number> = {};
  for (const d of angleDetails) angleScores[d.id] = d.score;

  await supabase.from('product_match_scores').upsert({
    hospital_id: hospitalId,
    product_id: TORR_RF_PRODUCT_ID,
    need_score: 0,
    fit_score: 0,
    timing_score: 0,
    total_score: matchTotal,
    grade: matchGrade,
    sales_angle_scores: angleScores,
    top_pitch_points: topPitchPoints,
    scored_at: new Date().toISOString(),
    scoring_version: 'v3.1-e2e',
  }, { onConflict: 'hospital_id,product_id' });

  return {
    profiler: profilerResult,
    matcher: {
      score: matchTotal,
      grade: matchGrade,
      angleDetails,
      topPitchPoints,
    },
  };
}

// ─── STEP 4: 결과 수집 ─────────────────────────
function parsePipelineOutput(stdout: string): Partial<HospitalReport['crawl']> {
  const textLenMatch = stdout.match(/Combined:\s*(\d+)\s*chars/);
  const subpageMatch = stdout.match(/Found\s*(\d+)\s*subpages/);
  const imgOcrMatch = stdout.match(/Image OCR:\s*\+(\d+)\s*eq.*\+(\d+)\s*tr/);
  const pass2Match = stdout.match(/Pass 2:\s*(\d+)\s*pages/);
  const downloadMatch = stdout.match(/Downloaded\s*(\d+)/i);

  return {
    textLength: textLenMatch ? parseInt(textLenMatch[1]) : 0,
    subpageCount: subpageMatch ? parseInt(subpageMatch[1]) : 0,
    imageDownloaded: downloadMatch ? parseInt(downloadMatch[1]) : 0,
    imageOcrCount: imgOcrMatch ? parseInt(imgOcrMatch[1]) + parseInt(imgOcrMatch[2]) : 0,
    screenshotOcr: pass2Match ? 'success' : stdout.includes('Pass 2 failed') ? 'fail' : 'skipped',
  };
}

// ─── 단건 실행 ──────────────────────────────────
async function runSingleTest(target: TestTarget): Promise<HospitalReport> {
  const startTime = Date.now();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`=== [${target.index}] ${target.name} ${target.difficulty} ===`);
  console.log(`URL: ${target.url}`);
  console.log(`검증: ${target.checkpoint}`);
  console.log(`${'═'.repeat(60)}`);

  const report: HospitalReport = {
    target,
    hospitalId: null,
    crawl: {
      status: 'fail',
      textLength: 0,
      subpageCount: 0,
      imageDownloaded: 0,
      imageOcrCount: 0,
      screenshotOcr: 'skipped',
      screenshotOcrTextLength: 0,
    },
    parsing: { equipments: [], treatments: [], prices: [], doctorCount: 0 },
    profiler: null,
    matcher: null,
    signals: { equipmentChanges: 0, salesSignals: [] },
    apiCost: { geminiCalls: 0, totalTokens: 0 },
    durationMs: 0,
  };

  // STEP 1: 병원 등록
  try {
    report.hospitalId = await ensureHospital(target);
    console.log(`  Hospital ID: ${report.hospitalId}`);
  } catch (err) {
    report.crawl.error = `Hospital registration failed: ${err instanceof Error ? err.message : String(err)}`;
    console.log(`  ❌ ${report.crawl.error}`);
    report.durationMs = Date.now() - startTime;
    return report;
  }

  // STEP 2: 크롤링 파이프라인
  console.log(`\n  --- 크롤링 파이프라인 실행 중... ---`);
  const pipeResult = await runCrawlPipeline(target.name);

  if (pipeResult.exitCode === 0) {
    report.crawl.status = 'success';
    const parsed = parsePipelineOutput(pipeResult.stdout);
    Object.assign(report.crawl, parsed);
  } else {
    report.crawl.status = 'fail';
    report.crawl.error = pipeResult.stderr.slice(0, 500);
    console.log(`  ❌ 크롤링 실패: ${report.crawl.error}`);
  }

  // DB에서 실제 저장된 데이터 조회 (크롤링 성공/부분 성공 모두)
  if (report.hospitalId) {
    const { data: eqs } = await supabase
      .from('sales_hospital_equipments')
      .select('equipment_name')
      .eq('hospital_id', report.hospitalId);
    report.parsing.equipments = (eqs ?? []).map((e: Record<string, unknown>) => e.equipment_name as string);

    const { data: trs } = await supabase
      .from('sales_hospital_treatments')
      .select('treatment_name, price, price_min, price_max')
      .eq('hospital_id', report.hospitalId);
    report.parsing.treatments = (trs ?? []).map((t: Record<string, unknown>) => t.treatment_name as string);
    report.parsing.prices = (trs ?? [])
      .filter((t: Record<string, unknown>) => t.price || t.price_min || t.price_max)
      .map((t: Record<string, unknown>) => {
        const name = t.treatment_name as string;
        const price = t.price ?? t.price_min ?? t.price_max;
        return `${name}: ${price}`;
      });

    const { data: drs } = await supabase
      .from('hospital_doctors')
      .select('id')
      .eq('hospital_id', report.hospitalId);
    report.parsing.doctorCount = drs?.length ?? 0;
  }

  // STEP 3: 프로파일 + 매칭
  if (report.hospitalId && report.parsing.equipments.length + report.parsing.treatments.length > 0) {
    console.log(`  --- 프로파일링 + 매칭 실행 중... ---`);
    try {
      const { profiler, matcher } = await runProfileAndMatch(report.hospitalId);
      report.profiler = profiler;
      report.matcher = matcher;
    } catch (err) {
      console.log(`  ⚠️ 스코어링 오류: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // STEP 4: 시그널 (첫 크롤링이므로 변동 없음이 정상)
  if (report.hospitalId) {
    const { count: changeCount } = await supabase
      .from('equipment_changes')
      .select('id', { count: 'exact', head: true })
      .eq('hospital_id', report.hospitalId);
    report.signals.equipmentChanges = changeCount ?? 0;

    const { data: signals } = await supabase
      .from('sales_signals')
      .select('signal_type, priority, title')
      .eq('hospital_id', report.hospitalId);
    report.signals.salesSignals = (signals ?? []).map(
      (s: Record<string, unknown>) => `${s.priority}/${s.signal_type}: ${s.title}`
    );
  }

  // API 비용 (api_usage_logs에서 조회)
  if (report.hospitalId) {
    const { data: logs } = await supabase
      .from('api_usage_logs')
      .select('input_tokens, output_tokens')
      .eq('hospital_id', report.hospitalId)
      .gte('created_at', new Date(startTime).toISOString());

    if (logs && logs.length > 0) {
      report.apiCost.geminiCalls = logs.length;
      report.apiCost.totalTokens = logs.reduce(
        (sum: number, l: Record<string, unknown>) =>
          sum + ((l.input_tokens as number) ?? 0) + ((l.output_tokens as number) ?? 0),
        0
      );
    }
  }

  report.durationMs = Date.now() - startTime;

  // 보고 출력
  printReport(report);
  return report;
}

// ─── 보고 출력 ──────────────────────────────────
function printReport(r: HospitalReport): void {
  console.log(`\n  === [${r.target.index}] ${r.target.name} ===`);
  console.log(`  URL: ${r.target.url}`);
  console.log(`  크롤링 상태: ${r.crawl.status}${r.crawl.error ? ` (${r.crawl.error.slice(0, 200)})` : ''}`);
  console.log(`  소요 시간: ${(r.durationMs / 1000).toFixed(1)}초`);

  console.log(`\n  [텍스트 크롤링]`);
  console.log(`  - 추출된 텍스트 길이: ${r.crawl.textLength}자`);
  console.log(`  - 서브페이지 탐색 수: ${r.crawl.subpageCount}개`);

  console.log(`\n  [이미지 OCR]`);
  console.log(`  - 다운로드 이미지 수: ${r.crawl.imageDownloaded}개`);
  console.log(`  - OCR 처리 항목 수: ${r.crawl.imageOcrCount}개`);

  console.log(`\n  [스크린샷 OCR]`);
  console.log(`  - 스크린샷 캡처: ${r.crawl.screenshotOcr}`);

  console.log(`\n  [파싱 결과]`);
  console.log(`  - 감지된 장비 (${r.parsing.equipments.length}): ${r.parsing.equipments.join(', ') || '없음'}`);
  console.log(`  - 감지된 시술 (${r.parsing.treatments.length}): ${r.parsing.treatments.slice(0, 10).join(', ')}${r.parsing.treatments.length > 10 ? ` 외 ${r.parsing.treatments.length - 10}건` : ''}`);
  console.log(`  - 감지된 가격 (${r.parsing.prices.length}): ${r.parsing.prices.slice(0, 5).join(', ')}${r.parsing.prices.length > 5 ? ` 외 ${r.parsing.prices.length - 5}건` : ''}`);
  console.log(`  - 의사 수: ${r.parsing.doctorCount}명`);

  if (r.profiler) {
    console.log(`\n  [스코어링 - 프로파일]`);
    console.log(`  - 프로파일 점수: ${r.profiler.score}점 (등급: ${r.profiler.grade})`);
    console.log(`  - 4축: investment=${r.profiler.investment}, portfolio=${r.profiler.portfolio}, scaleTrust=${r.profiler.scaleTrust}, marketing=${r.profiler.marketing}`);
  }

  if (r.matcher) {
    console.log(`\n  [스코어링 - TORR RF 매칭]`);
    console.log(`  - 매칭 점수: ${r.matcher.score}점 (등급: ${r.matcher.grade})`);
    for (const d of r.matcher.angleDetails) {
      console.log(`    - ${d.name}: ${d.score}점 [${d.matchedKw.join(', ')}]`);
    }
    console.log(`  - top_pitch_points: [${r.matcher.topPitchPoints.join(', ')}]`);
  }

  console.log(`\n  [시그널]`);
  console.log(`  - 장비 변동: ${r.signals.equipmentChanges}건 (첫 크롤링이면 0건 정상)`);
  console.log(`  - sales_signals: ${r.signals.salesSignals.length > 0 ? r.signals.salesSignals.join('; ') : '없음'}`);

  console.log(`\n  [API 비용]`);
  console.log(`  - Gemini 호출: ${r.apiCost.geminiCalls}회`);
  console.log(`  - 총 토큰: ${r.apiCost.totalTokens}`);
}

// ─── 종합 보고 ──────────────────────────────────
function printSummary(reports: HospitalReport[]): void {
  const success = reports.filter((r) => r.crawl.status === 'success' && r.parsing.equipments.length + r.parsing.treatments.length > 0);
  const partial = reports.filter((r) => r.crawl.status === 'success' && r.parsing.equipments.length + r.parsing.treatments.length === 0);
  const failed = reports.filter((r) => r.crawl.status === 'fail');

  const easy = reports.filter((r) => r.target.difficulty === '🟢');
  const medium = reports.filter((r) => r.target.difficulty === '🟡');
  const hard = reports.filter((r) => r.target.difficulty === '🔴');

  const countSuccess = (list: HospitalReport[]): number =>
    list.filter((r) => r.crawl.status === 'success' && r.parsing.equipments.length + r.parsing.treatments.length > 0).length;

  const totalGeminiCalls = reports.reduce((sum, r) => sum + r.apiCost.geminiCalls, 0);
  const totalTokens = reports.reduce((sum, r) => sum + r.apiCost.totalTokens, 0);
  // Gemini Flash: ~$0.075/1M input, ~$0.30/1M output → ~₩200/1M avg
  const estimatedCostKrw = Math.round(totalTokens * 0.0002);

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`=== E2E 테스트 종합 결과 ===`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`성공: ${success.length}/${reports.length}건`);
  console.log(`부분 성공: ${partial.length}/${reports.length}건 (크롤링 됐지만 데이터 부족)`);
  console.log(`실패: ${failed.length}/${reports.length}건`);

  console.log(`\n[난이도별 성공률]`);
  console.log(`🟢 쉬움 (${easy.length}건): ${countSuccess(easy)}/${easy.length}`);
  console.log(`🟡 중간 (${medium.length}건): ${countSuccess(medium)}/${medium.length}`);
  console.log(`🔴 어려움 (${hard.length}건): ${countSuccess(hard)}/${hard.length}`);

  console.log(`\n[Gemini API 총 비용]`);
  console.log(`- 총 호출 수: ${totalGeminiCalls}회`);
  console.log(`- 총 토큰: ${totalTokens.toLocaleString()}`);
  console.log(`- 예상 비용: ₩${estimatedCostKrw.toLocaleString()}`);

  if (failed.length > 0) {
    console.log(`\n[실패 목록]`);
    for (const r of failed) {
      console.log(`  ${r.target.index}. ${r.target.name}: ${r.crawl.error?.slice(0, 200)}`);
    }
  }

  if (partial.length > 0) {
    console.log(`\n[부분 성공 (데이터 부족)]`);
    for (const r of partial) {
      console.log(`  ${r.target.index}. ${r.target.name}: 장비=${r.parsing.equipments.length}, 시술=${r.parsing.treatments.length}`);
    }
  }

  // 주요 발견사항
  console.log(`\n[발견된 이슈 및 개선 필요 사항]`);
  const issues: string[] = [];
  for (const r of reports) {
    if (r.crawl.status === 'fail') {
      issues.push(`${r.target.name}: 크롤링 실패 — ${r.crawl.error?.slice(0, 100)}`);
    } else if (r.parsing.equipments.length === 0 && r.parsing.treatments.length === 0) {
      issues.push(`${r.target.name}: 장비/시술 미감지 — 파싱 개선 필요`);
    } else if (r.crawl.screenshotOcr === 'fail') {
      issues.push(`${r.target.name}: 스크린샷 OCR 실패`);
    }
  }
  if (issues.length === 0) issues.push('주요 이슈 없음');
  issues.forEach((issue, i) => console.log(`  ${i + 1}. ${issue}`));
}

// ─── MAIN ───────────────────────────────────────
async function main(): Promise<void> {
  const indexArg = process.argv.find((a) => a.startsWith('--index'));
  const singleIndex = indexArg ? parseInt(process.argv[process.argv.indexOf(indexArg) + 1]) : null;

  const targets = singleIndex
    ? TARGETS.filter((t) => t.index === singleIndex)
    : TARGETS;

  if (targets.length === 0) {
    console.log('No targets found');
    process.exit(1);
  }

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`E2E 크롤러 테스트 — ${targets.length}건 순차 실행`);
  console.log(`${'═'.repeat(60)}`);

  // TORR RF 제품 존재 확인
  const { data: product } = await supabase
    .from('sales_products')
    .select('id, name')
    .eq('id', TORR_RF_PRODUCT_ID)
    .single();

  if (!product) {
    console.log(`❌ TORR RF 제품이 DB에 없습니다 (id=${TORR_RF_PRODUCT_ID})`);
    // 제품 ID 목록 출력
    const { data: products } = await supabase.from('sales_products').select('id, name');
    console.log('등록된 제품:', products);
    process.exit(1);
  }
  console.log(`제품: ${product.name} (${product.id})`);

  const reports: HospitalReport[] = [];

  for (const target of targets) {
    const report = await runSingleTest(target);
    reports.push(report);

    // 사이트 간 간격 (15초)
    if (target !== targets[targets.length - 1]) {
      console.log(`\n  ⏳ 다음 병원까지 15초 대기...`);
      await delay(15000);
    }
  }

  // 종합 보고
  if (reports.length > 1) {
    printSummary(reports);
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
