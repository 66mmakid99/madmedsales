/**
 * crm-firecrawl-deep.ts
 * 
 * 역할: URL 확보된 병원을 Firecrawl로 멀티페이지 크롤링
 * 실행: npx tsx scripts/crm-firecrawl-deep.ts
 * 옵션: --force (이미 데이터 있는 병원도 재크롤링)
 *       --dry-run (크롤링 없이 대상만 확인)
 *       --limit 10 (최대 N개만 크롤링)
 * 
 * 기존 크롤링 대비 개선:
 * 1. Firecrawl /map → 시술/장비 관련 서브페이지 발견
 * 2. 멀티페이지 크롤 → 더 많은 장비/시술 데이터 수집
 * 3. JS 렌더링 → SPA 사이트도 크롤 가능
 * 
 * 필요 env:
 *   FIRECRAWL_API_KEY (크레딧 2,400 잔여)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 *   GEMINI_API_KEY (AI 분석용)
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import { createClient } from '@supabase/supabase-js';

const firecrawl = new FirecrawlApp({ apiKey: process.env.FIRECRAWL_API_KEY! });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

// ============================================================
// 설정
// ============================================================
const MAX_PAGES_PER_HOSPITAL = 7;  // 병원당 최대 크롤 페이지
const DELAY_BETWEEN_HOSPITALS = 3000; // ms
const DELAY_BETWEEN_PAGES = 1000;     // ms

// 시술/장비 관련 URL 패턴 (이 패턴에 매칭되는 서브페이지만 크롤)
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

// 제외 URL 패턴
const EXCLUDE_PATTERNS = [
  /blog|news|notice|공지|후기|review|board|게시판/i,
  /recruit|채용|career/i,
  /privacy|개인정보|policy|약관/i,
  /\.pdf$|\.jpg$|\.png$|\.gif$/i,
  /login|signup|register|member/i,
  /map|오시는|찾아오시는/i,
];

// ============================================================
// URL 필터링
// ============================================================
function isRelevantUrl(url: string, baseUrl: string): boolean {
  // 같은 도메인인지 확인
  try {
    const base = new URL(baseUrl);
    const target = new URL(url);
    if (base.hostname !== target.hostname) return false;
  } catch { return false; }

  // 제외 패턴 체크
  if (EXCLUDE_PATTERNS.some(p => p.test(url))) return false;
  
  // 관련 패턴 체크
  return RELEVANT_PATTERNS.some(p => p.test(url));
}

// ============================================================
// 단일 병원 크롤링
// ============================================================
async function crawlHospital(name: string, url: string): Promise<{
  success: boolean;
  markdown: string;
  pagesCrawled: number;
  creditUsed: number;
  error?: string;
}> {
  console.log(`\n🏥 [${name}] 크롤링 시작: ${url}`);
  let creditUsed = 0;

  try {
    // Step 1: 사이트맵 추출 (/map)
    console.log('  📍 사이트맵 추출...');
    let urlsToCrawl = [url];
    
    try {
      const mapResult = await firecrawl.mapUrl(url);
      creditUsed += 1;
      
      if (mapResult.success && mapResult.links && mapResult.links.length > 0) {
        const allLinks = mapResult.links as string[];
        console.log(`  📄 사이트 내 총 ${allLinks.length}개 URL 발견`);
        
        // 관련 URL 필터
        const relevant = allLinks.filter(link => isRelevantUrl(link, url));
        console.log(`  🎯 관련 URL: ${relevant.length}개`);
        
        // 메인 + 관련 URL (최대 제한)
        urlsToCrawl = [url, ...relevant.slice(0, MAX_PAGES_PER_HOSPITAL - 1)];
        urlsToCrawl = [...new Set(urlsToCrawl)]; // 중복 제거
      }
    } catch (mapErr) {
      console.log(`  ⚠️ 사이트맵 실패, 메인만 크롤: ${mapErr}`);
    }

    console.log(`  🔄 크롤할 페이지: ${urlsToCrawl.length}개`);

    // Step 2: 각 페이지 크롤
    const markdownParts: string[] = [];
    
    for (const targetUrl of urlsToCrawl) {
      try {
        console.log(`    → ${targetUrl.substring(0, 70)}...`);
        
        const result = await firecrawl.scrapeUrl(targetUrl, {
          formats: ['markdown'],
          waitFor: 3000,
          timeout: 30000,
        });
        creditUsed += 1;
        
        if (result.success && result.markdown) {
          const md = result.markdown as string;
          markdownParts.push(`\n\n--- PAGE: ${targetUrl} ---\n\n${md}`);
          console.log(`    ✅ ${md.length}자 수집`);
        } else {
          console.log(`    ⚠️ 마크다운 없음`);
        }
      } catch (scrapeErr) {
        console.log(`    ❌ 실패: ${scrapeErr}`);
      }
      
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_PAGES));
    }

    const combined = markdownParts.join('\n');
    console.log(`  📊 총 ${combined.length}자 | ${urlsToCrawl.length}페이지 | ${creditUsed} 크레딧`);

    return {
      success: combined.length > 200,
      markdown: combined,
      pagesCrawled: markdownParts.length,
      creditUsed,
    };

  } catch (err) {
    console.error(`  ❌ 전체 실패: ${err}`);
    return { success: false, markdown: '', pagesCrawled: 0, creditUsed, error: String(err) };
  }
}

// ============================================================
// Gemini AI 분석 (장비/시술/의사 추출)
// ============================================================
async function analyzeWithGemini(name: string, markdown: string): Promise<{
  equipments: any[];
  treatments: any[];
  doctors: any[];
} | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('  ⚠️ GEMINI_API_KEY 없음, 분석 스킵');
    return null;
  }

  // 텍스트가 너무 길면 청킹
  const maxChars = 28000;
  const text = markdown.length > maxChars ? markdown.substring(0, maxChars) : markdown;

  const prompt = `당신은 한국 피부과/성형외과 의료기기 전문가입니다.
아래는 "${name}" 병원의 웹사이트 텍스트입니다.

이 텍스트에서 다음 정보를 추출해주세요:

1. **장비 목록** (equipments): 병원이 보유한 의료 장비/기기
   - name: 장비명 (한글 우선, 예: "울쎄라", "써마지 FLX")
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

JSON 형식으로만 응답하세요. 마크다운이나 설명 없이 순수 JSON만:
{
  "equipments": [...],
  "treatments": [...],
  "doctors": [...]
}

주의사항:
- 장비와 시술을 구분하세요 (장비=기기 이름, 시술=서비스명)
- "토르", "TORR", "TORR RF" 관련 언급이 있으면 반드시 포함
- 카테고리가 애매하면 best guess로 분류
- 발견되지 않는 항목은 빈 배열 []

웹사이트 텍스트:
${text}`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
        }),
      }
    );

    const data = await res.json();
    let responseText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    // JSON 추출 (```json ... ``` 제거)
    responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    const parsed = JSON.parse(responseText);
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
  markdown: string, 
  analysis: { equipments: any[]; treatments: any[]; doctors: any[] } | null,
  pagesCrawled: number
) {
  // 1. hospitals 테이블에서 해당 병원 찾기 (또는 crm_hospitals 통해)
  const { data: crmHospital } = await supabase
    .from('crm_hospitals')
    .select('id, hospital_id')
    .eq('name', hospitalName)
    .eq('tenant_id', TENANT_ID)
    .single();

  if (!crmHospital) {
    console.log(`  ⚠️ DB에서 "${hospitalName}" 못 찾음 → 신규 생성 필요`);
    return;
  }

  let hospitalId = crmHospital.hospital_id;

  // hospital_id가 없으면 hospitals 테이블에 새로 생성
  if (!hospitalId) {
    const { data: newHospital, error } = await supabase
      .from('hospitals')
      .insert({
        name: hospitalName,
        tenant_id: TENANT_ID,
        raw_text: markdown,
        crawled_at: new Date().toISOString(),
        crawl_source: 'firecrawl',
        crawl_pages: pagesCrawled,
      })
      .select('id')
      .single();

    if (error || !newHospital) {
      console.log(`  ❌ hospitals INSERT 실패: ${error?.message}`);
      return;
    }

    hospitalId = newHospital.id;

    // crm_hospitals에 hospital_id 연결
    await supabase
      .from('crm_hospitals')
      .update({ hospital_id: hospitalId })
      .eq('id', crmHospital.id);
    
    console.log(`  📝 신규 hospital 생성 & CRM 연결: ${hospitalId}`);
  } else {
    // 기존 hospital 업데이트
    await supabase
      .from('hospitals')
      .update({
        raw_text: markdown,
        crawled_at: new Date().toISOString(),
        crawl_source: 'firecrawl',
        crawl_pages: pagesCrawled,
      })
      .eq('id', hospitalId);
  }

  // 2. 분석 결과 저장
  if (analysis) {
    // 기존 데이터 삭제 후 재삽입
    await supabase.from('hospital_equipments').delete().eq('hospital_id', hospitalId);
    await supabase.from('hospital_treatments').delete().eq('hospital_id', hospitalId);
    await supabase.from('hospital_doctors').delete().eq('hospital_id', hospitalId);

    if (analysis.equipments?.length > 0) {
      const eqRows = analysis.equipments.map(eq => ({
        hospital_id: hospitalId,
        name: eq.name,
        category: eq.category || 'other',
        manufacturer: eq.manufacturer || null,
        brand: eq.brand || null,
        model: eq.model || null,
      }));
      await supabase.from('hospital_equipments').insert(eqRows);
    }

    if (analysis.treatments?.length > 0) {
      const trRows = analysis.treatments.map(tr => ({
        hospital_id: hospitalId,
        name: tr.name,
        category: tr.category || 'other',
        price: tr.price || null,
        price_event: tr.price_event || null,
        is_promoted: tr.is_promoted || false,
      }));
      await supabase.from('hospital_treatments').insert(trRows);
    }

    if (analysis.doctors?.length > 0) {
      const drRows = analysis.doctors.map(dr => ({
        hospital_id: hospitalId,
        name: dr.name,
        title: dr.title || '원장',
        specialty: dr.specialty || null,
      }));
      await supabase.from('hospital_doctors').insert(drRows);
    }
  }

  console.log(`  💾 Supabase 저장 완료 (hospital_id: ${hospitalId})`);
}

// ============================================================
// 메인 실행
// ============================================================
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const dryRun = args.includes('--dry-run');
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : 999;

  // URL 검색 결과 로드 (Phase 1에서 생성)
  const fs = await import('fs');
  let urlResults: Array<{ no: number; name: string; website: string; phase: string }>;
  
  try {
    urlResults = JSON.parse(fs.readFileSync('scripts/data/url-search-results.json', 'utf-8'));
  } catch {
    console.log('⚠️ url-search-results.json 없음. 기존 KNOWN_URLS 사용.');
    // 폴백: 하드코딩된 URL 사용
    urlResults = []; // Phase 1 먼저 실행 필요
    return;
  }

  // 크롤링 대상 필터
  const targets = urlResults
    .filter(h => h.website && h.phase === 'CRAWL')
    .slice(0, limit);

  console.log(`🚀 Firecrawl 딥크롤링 시작`);
  console.log(`  대상: ${targets.length}개 병원`);
  console.log(`  모드: ${dryRun ? 'DRY RUN' : force ? 'FORCE (재크롤링 포함)' : 'NORMAL'}`);
  console.log(`  예상 크레딧: ~${targets.length * 5} (최대 ${targets.length * MAX_PAGES_PER_HOSPITAL})`);
  console.log();

  if (dryRun) {
    targets.forEach(t => console.log(`  ${t.no}. ${t.name}: ${t.website}`));
    return;
  }

  let totalSuccess = 0, totalFail = 0, totalCredits = 0;

  for (const target of targets) {
    // 크롤링
    const crawlResult = await crawlHospital(target.name, target.website);
    totalCredits += crawlResult.creditUsed;

    if (crawlResult.success) {
      // AI 분석
      const analysis = await analyzeWithGemini(target.name, crawlResult.markdown);
      
      // DB 저장
      await saveToSupabase(target.name, crawlResult.markdown, analysis, crawlResult.pagesCrawled);
      
      totalSuccess++;
    } else {
      totalFail++;
    }

    await new Promise(r => setTimeout(r, DELAY_BETWEEN_HOSPITALS));
  }

  console.log(`\n========================================`);
  console.log(`✅ 성공: ${totalSuccess} | ❌ 실패: ${totalFail}`);
  console.log(`💳 총 크레딧 사용: ~${totalCredits}`);
  console.log(`========================================`);
}

main().catch(console.error);
