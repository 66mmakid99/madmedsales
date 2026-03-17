/**
 * step2-crawl-analyze.ts
 *
 * Step 2+3: Firecrawl 멀티페이지 크롤링 + Gemini Flash AI 분석
 * - step2-crawl-targets.json에서 대상 로드
 * - Firecrawl mapUrl → 서브페이지 필터 → scrapeUrl
 * - Gemini Flash로 장비/시술/의사 추출
 * - Supabase 저장 (hospitals, hospital_equipments, hospital_treatments, hospital_doctors)
 *
 * 실행: npx tsx scripts/step2-crawl-analyze.ts
 * 옵션: --dry-run (대상만 확인)
 *       --limit 5 (최대 N개)
 *       --skip-gemini (크롤링만, 분석 스킵)
 *       --start-from 10 (10번째 대상부터)
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import { supabase } from './utils/supabase.js';
import { getAccessToken } from './analysis/gemini-auth.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================
// 설정
// ============================================================
const MAX_PAGES_PER_HOSPITAL = 7;
const DELAY_BETWEEN_HOSPITALS = 3000;
const DELAY_BETWEEN_PAGES = 1000;
const GEMINI_MODEL = 'gemini-2.0-flash';
const MAX_TEXT_CHARS = 28000;

// Firecrawl 초기화
const firecrawlApiKey = process.env.FIRECRAWL_API_KEY;
if (!firecrawlApiKey) {
  console.error('❌ FIRECRAWL_API_KEY 미설정');
  process.exit(1);
}
const firecrawlApp = new FirecrawlApp({ apiKey: firecrawlApiKey });
// v4 SDK: methods are under .v1 namespace
const firecrawl = firecrawlApp.v1;

// ============================================================
// URL 필터 패턴
// ============================================================
const RELEVANT_PATTERNS = [
  /lift|리프팅|hifu|rf|laser|레이저/i,
  /treat|시술|program|프로그램|menu|메뉴/i,
  /equip|장비|device|기기/i,
  /doctor|의료진|원장|staff|about|소개/i,
  /skin|피부|beauty|미용|anti.?aging/i,
  /price|가격|비용|event|이벤트/i,
  /body|바디|체형|slim|슬리밍/i,
  /filler|필러|botox|보톡스|booster|부스터/i,
];

const EXCLUDE_PATTERNS = [
  /blog|news|notice|공지|후기|review|board|게시판/i,
  /recruit|채용|career/i,
  /privacy|개인정보|policy|약관/i,
  /\.pdf$|\.jpg$|\.png$|\.gif$/i,
  /login|signup|register|member/i,
  /map|오시는|찾아오시는/i,
];

function isRelevantUrl(url: string, baseUrl: string): boolean {
  try {
    const base = new URL(baseUrl);
    const target = new URL(url);
    if (base.hostname !== target.hostname) return false;
  } catch { return false; }

  if (EXCLUDE_PATTERNS.some(p => p.test(url))) return false;
  return RELEVANT_PATTERNS.some(p => p.test(url));
}

// ============================================================
// Firecrawl 크롤링
// ============================================================
interface CrawlResult {
  success: boolean;
  markdown: string;
  pagesCrawled: number;
  creditUsed: number;
  error?: string;
}

async function crawlHospital(name: string, url: string): Promise<CrawlResult> {
  console.log(`\n🏥 [${name}] 크롤링: ${url}`);
  let creditUsed = 0;

  try {
    // Step 1: 사이트맵 추출
    let urlsToCrawl = [url];

    try {
      console.log('  📍 사이트맵 추출...');
      const mapResult = await firecrawl.mapUrl(url, { limit: 50 });
      creditUsed += 1;

      if (mapResult.success && mapResult.links && mapResult.links.length > 0) {
        const allLinks = mapResult.links as string[];
        console.log(`  📄 총 ${allLinks.length}개 URL`);

        const relevant = allLinks.filter(link => isRelevantUrl(link, url));
        console.log(`  🎯 관련 URL: ${relevant.length}개`);

        urlsToCrawl = [url, ...relevant.slice(0, MAX_PAGES_PER_HOSPITAL - 1)];
        urlsToCrawl = [...new Set(urlsToCrawl)];
      }
    } catch (mapErr) {
      console.log(`  ⚠️ 사이트맵 실패, 메인만 크롤`);
    }

    console.log(`  🔄 ${urlsToCrawl.length}페이지 크롤...`);

    // Step 2: 각 페이지 scrape
    const markdownParts: string[] = [];

    for (const targetUrl of urlsToCrawl) {
      try {
        const shortUrl = targetUrl.length > 70 ? targetUrl.substring(0, 70) + '...' : targetUrl;
        console.log(`    → ${shortUrl}`);

        const result = await firecrawl.scrapeUrl(targetUrl, {
          formats: ['markdown'],
          waitFor: 3000,
          timeout: 30000,
        });
        creditUsed += 1;

        if (result.success && result.markdown) {
          const md = result.markdown as string;
          markdownParts.push(`\n\n--- PAGE: ${targetUrl} ---\n\n${md}`);
          console.log(`    ✅ ${md.length.toLocaleString()}자`);
        } else {
          console.log(`    ⚠️ 마크다운 없음`);
        }
      } catch (scrapeErr) {
        console.log(`    ❌ ${scrapeErr}`);
      }

      await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
    }

    const combined = markdownParts.join('\n');
    console.log(`  📊 ${combined.length.toLocaleString()}자 | ${markdownParts.length}/${urlsToCrawl.length}페이지 | ${creditUsed}크레딧`);

    return {
      success: combined.length > 200,
      markdown: combined,
      pagesCrawled: markdownParts.length,
      creditUsed,
    };
  } catch (err) {
    console.error(`  ❌ 크롤링 실패: ${err}`);
    return { success: false, markdown: '', pagesCrawled: 0, creditUsed, error: String(err) };
  }
}

// ============================================================
// Gemini AI 분석
// ============================================================
interface AnalysisResult {
  equipments: Array<{
    name: string;
    category: string;
    manufacturer?: string;
  }>;
  treatments: Array<{
    name: string;
    category: string;
    price?: number | null;
    is_promoted?: boolean;
  }>;
  doctors: Array<{
    name: string;
    title: string;
    specialty?: string;
  }>;
}

async function analyzeWithGemini(name: string, markdown: string): Promise<AnalysisResult | null> {
  const text = markdown.length > MAX_TEXT_CHARS ? markdown.substring(0, MAX_TEXT_CHARS) : markdown;

  const prompt = `당신은 한국 피부과/성형외과 의료기기 전문가입니다.
아래는 "${name}" 병원의 웹사이트 텍스트입니다.

이 텍스트에서 다음 정보를 추출해주세요:

1. **장비 목록** (equipments): 병원이 보유한 의료 장비/기기
   - name: 장비명 (한글 우선)
   - category: laser | rf | hifu | body | lifting | booster | other
   - manufacturer: 제조사 (알면)

2. **시술 목록** (treatments): 제공하는 시술/프로그램
   - name: 시술명
   - category: lifting | laser | body | booster | filler_botox | skin | hair | other
   - price: 가격 (숫자, 원 단위, 모르면 null)
   - is_promoted: 메인/이벤트에 강조되어 있으면 true

3. **의사 목록** (doctors): 의료진 정보
   - name: 이름
   - title: 직함 (대표원장, 원장 등)
   - specialty: 전공

JSON 형식으로만 응답하세요:
{
  "equipments": [...],
  "treatments": [...],
  "doctors": [...]
}

주의:
- 장비와 시술을 구분 (장비=기기 이름, 시술=서비스명)
- "토르", "TORR", "TORR RF", "컴포트듀얼" 관련 언급 반드시 포함
- 장비 정규화: 써마지→Thermage FLX, 울쎄라→Ulthera, 슈링크→Shrink, 인모드→InMode, 토르→TORR RF
- 발견 안 되면 빈 배열 []

웹사이트 텍스트:
${text}`;

  try {
    const accessToken = await getAccessToken();
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API ${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    let responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // JSON 추출
    responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

    const parsed: AnalysisResult = JSON.parse(responseText);
    console.log(`  🤖 Gemini: 장비 ${parsed.equipments?.length || 0}개, 시술 ${parsed.treatments?.length || 0}개, 의사 ${parsed.doctors?.length || 0}명`);

    return parsed;
  } catch (err) {
    console.error(`  ❌ Gemini 분석 실패: ${err}`);
    return null;
  }
}

// ============================================================
// Supabase 저장
// ============================================================
async function saveToSupabase(
  hospitalName: string,
  url: string,
  markdown: string,
  analysis: AnalysisResult | null,
  pagesCrawled: number
): Promise<void> {
  // 1. crm_hospitals에서 찾기
  const { data: crmHospital } = await supabase
    .from('crm_hospitals')
    .select('id, sales_hospital_id, name')
    .eq('name', hospitalName)
    .eq('tenant_id', TENANT_ID)
    .single();

  if (!crmHospital) {
    console.log(`  ⚠️ CRM에서 "${hospitalName}" 못 찾음`);
    return;
  }

  let hospitalId = crmHospital.sales_hospital_id;

  // 2. hospitals 테이블에 생성/업데이트
  // hospitals 컬럼: name, website, crawled_at (raw_text 없음)
  if (!hospitalId) {
    // 이름으로 기존 hospital 검색
    const { data: existing } = await supabase
      .from('hospitals')
      .select('id')
      .eq('name', hospitalName)
      .limit(1)
      .single();

    if (existing) {
      hospitalId = existing.id;
      await supabase
        .from('hospitals')
        .update({
          website: url,
          crawled_at: new Date().toISOString(),
        })
        .eq('id', hospitalId);
    } else {
      // 신규 생성
      const { data: newH, error } = await supabase
        .from('hospitals')
        .insert({
          name: hospitalName,
          website: url,
          crawled_at: new Date().toISOString(),
        })
        .select('id')
        .single();

      if (error || !newH) {
        console.log(`  ❌ hospital INSERT 실패: ${error?.message}`);
        return;
      }
      hospitalId = newH.id;
    }

    // crm_hospitals에 연결
    await supabase
      .from('crm_hospitals')
      .update({ sales_hospital_id: hospitalId })
      .eq('id', crmHospital.id);

    console.log(`  📝 hospital 연결: ${hospitalId}`);
  } else {
    // 기존 hospital 업데이트
    await supabase
      .from('hospitals')
      .update({
        website: url,
        crawled_at: new Date().toISOString(),
      })
      .eq('id', hospitalId);
  }

  // 3. 분석 결과 저장
  if (analysis) {
    // 기존 데이터 삭제 후 재삽입
    await supabase.from('sales_hospital_equipments').delete().eq('hospital_id', hospitalId);
    await supabase.from('sales_hospital_treatments').delete().eq('hospital_id', hospitalId);
    await supabase.from('sales_hospital_doctors').delete().eq('hospital_id', hospitalId);

    // hospital_equipments: equipment_name, equipment_category, equipment_brand, manufacturer
    if (analysis.equipments?.length > 0) {
      const eqRows = analysis.equipments.map(eq => ({
        hospital_id: hospitalId,
        equipment_name: eq.name,
        equipment_category: eq.category || 'other',
        manufacturer: eq.manufacturer || null,
        source: 'firecrawl_gemini',
      }));
      const { error } = await supabase.from('sales_hospital_equipments').insert(eqRows);
      if (error) console.log(`  ⚠️ 장비 INSERT: ${error.message}`);
    }

    // hospital_treatments: treatment_name, treatment_category, price, is_promoted
    if (analysis.treatments?.length > 0) {
      const trRows = analysis.treatments.map(tr => ({
        hospital_id: hospitalId,
        treatment_name: tr.name,
        treatment_category: tr.category || 'other',
        price: tr.price || null,
        is_promoted: tr.is_promoted || false,
        source: 'firecrawl_gemini',
      }));
      const { error } = await supabase.from('sales_hospital_treatments').insert(trRows);
      if (error) console.log(`  ⚠️ 시술 INSERT: ${error.message}`);
    }

    if (analysis.doctors?.length > 0) {
      const drRows = analysis.doctors.map(dr => ({
        hospital_id: hospitalId,
        name: dr.name,
        title: dr.title || '원장',
        specialty: dr.specialty || null,
      }));
      const { error } = await supabase.from('sales_hospital_doctors').insert(drRows);
      if (error) console.log(`  ⚠️ 의사 INSERT: ${error.message}`);
    }
  }

  console.log(`  💾 저장 완료 (hospital_id: ${hospitalId})`);
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const skipGemini = args.includes('--skip-gemini');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;
  const startIdx = args.indexOf('--start-from');
  const startFrom = startIdx >= 0 ? parseInt(args[startIdx + 1]) : 0;

  console.log('═══════════════════════════════════════════════════');
  console.log('  Step 2+3: Firecrawl 크롤링 + Gemini AI 분석');
  console.log('═══════════════════════════════════════════════════\n');

  // 대상 로드
  const targetsPath = path.resolve(__dirname, 'data', 'step2-crawl-targets.json');
  interface CrawlTarget {
    no: number;
    name: string;
    region: string;
    url: string;
    source: string;
  }
  const allTargets: CrawlTarget[] = JSON.parse(fs.readFileSync(targetsPath, 'utf-8'));
  const targets = allTargets.slice(startFrom, startFrom + limit);

  console.log(`📋 전체 대상: ${allTargets.length}개`);
  console.log(`📋 이번 실행: ${targets.length}개 (${startFrom}번째부터)`);
  console.log(`🔧 모드: ${dryRun ? 'DRY RUN' : skipGemini ? '크롤링만 (분석 스킵)' : '크롤링 + AI 분석'}`);
  console.log(`💳 예상 크레딧: ~${targets.length * 5} (최대 ${targets.length * MAX_PAGES_PER_HOSPITAL})\n`);

  if (dryRun) {
    for (const t of targets) {
      console.log(`  No.${t.no} ${t.name} (${t.region}): ${t.url}`);
    }
    console.log(`\n총 ${targets.length}개 병원`);
    return;
  }

  // Gemini 연결 테스트
  if (!skipGemini) {
    try {
      const token = await getAccessToken();
      console.log(`✅ Gemini SA 인증 확인 (토큰 길이: ${token.length})\n`);
    } catch (err) {
      console.error(`❌ Gemini 인증 실패: ${err}`);
      console.log('   --skip-gemini 옵션으로 크롤링만 실행 가능');
      process.exit(1);
    }
  }

  let totalSuccess = 0;
  let totalFail = 0;
  let totalCredits = 0;
  let totalEquip = 0;
  let totalTreat = 0;
  let totalDoctors = 0;

  const results: Array<{
    no: number;
    name: string;
    url: string;
    crawlOk: boolean;
    pages: number;
    credits: number;
    equip: number;
    treat: number;
    doctors: number;
    error?: string;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    console.log(`\n───── [${i + 1}/${targets.length}] ─────`);

    // 크롤링
    const crawlResult = await crawlHospital(t.name, t.url);
    totalCredits += crawlResult.creditUsed;

    if (crawlResult.success) {
      let analysis: AnalysisResult | null = null;

      // AI 분석
      if (!skipGemini) {
        analysis = await analyzeWithGemini(t.name, crawlResult.markdown);
        await new Promise(r => setTimeout(r, 1000)); // Gemini rate limit
      }

      // DB 저장
      await saveToSupabase(t.name, t.url, crawlResult.markdown, analysis, crawlResult.pagesCrawled);

      const eq = analysis?.equipments?.length || 0;
      const tr = analysis?.treatments?.length || 0;
      const dr = analysis?.doctors?.length || 0;
      totalEquip += eq;
      totalTreat += tr;
      totalDoctors += dr;
      totalSuccess++;

      results.push({
        no: t.no, name: t.name, url: t.url,
        crawlOk: true, pages: crawlResult.pagesCrawled,
        credits: crawlResult.creditUsed,
        equip: eq, treat: tr, doctors: dr,
      });
    } else {
      totalFail++;
      results.push({
        no: t.no, name: t.name, url: t.url,
        crawlOk: false, pages: 0, credits: crawlResult.creditUsed,
        equip: 0, treat: 0, doctors: 0,
        error: crawlResult.error,
      });
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
  }

  // 결과 저장
  const outputPath = path.resolve(__dirname, 'data', 'step2-results.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Step 2+3 결과 요약');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  ✅ 성공: ${totalSuccess}개`);
  console.log(`  ❌ 실패: ${totalFail}개`);
  console.log(`  💳 크레딧 사용: ${totalCredits}`);
  console.log(`  📊 장비: ${totalEquip}개 | 시술: ${totalTreat}개 | 의사: ${totalDoctors}명`);
  console.log(`  💾 결과: ${outputPath}`);

  if (totalFail > 0) {
    console.log(`\n⚠️ 실패 병원:`);
    results.filter(r => !r.crawlOk).forEach(r => {
      console.log(`   No.${r.no} ${r.name}: ${r.error || 'unknown'}`);
    });
  }
}

main().catch(console.error);
