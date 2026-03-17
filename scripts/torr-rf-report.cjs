const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs = require('fs');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const mapping = JSON.parse(fs.readFileSync(require('path').resolve(__dirname, '..', '..', 'madmedscv', 'scripts', 'torr-rf-hospital-ids.json'),'utf8'));
  const master = JSON.parse(fs.readFileSync('torr-rf-master-71-v2.json','utf8'));
  const ids = mapping.map(m => m.hospitalId);

  // Doctor data
  const { data: docs } = await sb.from('hospital_doctors').select('hospital_id, name, position, specialty').in('hospital_id', ids);
  const docMap = {};
  (docs||[]).forEach(d => {
    if (!docMap[d.hospital_id]) docMap[d.hospital_id] = [];
    docMap[d.hospital_id].push(d);
  });

  // Page counts
  const { data: pageCounts } = await sb.from('scv_crawl_pages').select('hospital_id').in('hospital_id', ids);
  const pageMap = {};
  (pageCounts||[]).forEach(p => { pageMap[p.hospital_id] = (pageMap[p.hospital_id]||0)+1; });

  // DNA
  const { data: dna } = await sb.from('scv_crawl_dna').select('hospital_id, site_type, cms_platform, has_doctor_page, has_equipment_page, has_treatment_page, has_price_page').in('hospital_id', ids);
  const dnaMap = {};
  (dna||[]).forEach(d => dnaMap[d.hospital_id] = d);

  // Snapshots
  const { data: snaps } = await sb.from('scv_crawl_snapshots').select('hospital_id, equipments_found, treatments_found, doctors_found, pass_number').in('hospital_id', ids).order('created_at', {ascending: false});
  const snapMap = {};
  (snaps||[]).forEach(s => {
    if (!snapMap[s.hospital_id]) snapMap[s.hospital_id] = s;
  });

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║    TORR RF 기고객 61개 병원 SCV 크롤링 결과 보고서              ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');
  console.log('');

  // 1. Overall summary
  const total = mapping.length;
  const good = mapping.filter(m => (pageMap[m.hospitalId]||0) >= 5).length;
  const partial = mapping.filter(m => { const c = pageMap[m.hospitalId]||0; return c >= 1 && c < 5; }).length;
  const failed = mapping.filter(m => !pageMap[m.hospitalId]).length;
  const withDocs = mapping.filter(m => (docMap[m.hospitalId]||[]).length > 0).length;
  const totalDocs = (docs||[]).length;

  console.log('┌─ 1. 크롤링 결과 요약 ──────────────────────────────────────────┐');
  console.log(`│  전체 대상: ${total}개 병원`);
  console.log(`│  양호 (5p+): ${good}개 (${Math.round(good/total*100)}%)`);
  console.log(`│  부분 (1-4p): ${partial}개 (${Math.round(partial/total*100)}%)`);
  console.log(`│  실패 (0p): ${failed}개 (${Math.round(failed/total*100)}%)`);
  console.log(`│  의사 추출 성공: ${withDocs}개 병원, 총 ${totalDocs}명`);
  console.log('└────────────────────────────────────────────────────────────────────┘');

  // 2. 기존 DB 병원 비교 (in_db=true)
  const inDb = mapping.filter(m => {
    const me = master.find(x => x.no === m.no);
    return me && me.in_db;
  });

  console.log('');
  console.log('┌─ 2. 기존 DB 병원 (31개) 크롤링 전후 비교 ─────────────────────┐');
  console.log('│  No  병원명              pages  의사  장비(M)  시술(M)  siteType');
  console.log('│  ─── ─────────────────── ────── ───── ─────── ─────── ─────────');

  let improvedCount = 0;
  let degradedCount = 0;

  for (const m of inDb.sort((a,b) => a.no - b.no)) {
    const me = master.find(x => x.no === m.no);
    const pages = pageMap[m.hospitalId] || 0;
    const docCount = (docMap[m.hospitalId]||[]).length;
    const d = dnaMap[m.hospitalId];
    const siteType = d ? d.site_type : '-';
    const meqc = me.eq_count || 0;
    const mtrc = me.tr_count || 0;

    let status = '';
    if (pages >= 5 && docCount > 0) status = '✅';
    else if (pages >= 5) status = '⚠️';
    else if (pages > 0) status = '🟡';
    else status = '❌';

    console.log(`│  ${status} #${String(m.no).padEnd(3)} ${m.name.padEnd(18)} ${String(pages).padStart(3)}p   ${String(docCount).padStart(2)}명   ${String(meqc).padStart(3)}개    ${String(mtrc).padStart(3)}개    ${siteType}`);
  }
  console.log('└────────────────────────────────────────────────────────────────────┘');

  // 3. 신규 병원
  const newOnes = mapping.filter(m => {
    const me = master.find(x => x.no === m.no);
    return !me || !me.in_db;
  });

  console.log('');
  console.log('┌─ 3. 신규 병원 (30개) 크롤링 결과 ─────────────────────────────┐');
  console.log('│  No  병원명              pages  의사  siteType');
  console.log('│  ─── ─────────────────── ────── ───── ─────────');

  for (const m of newOnes.sort((a,b) => a.no - b.no)) {
    const pages = pageMap[m.hospitalId] || 0;
    const docCount = (docMap[m.hospitalId]||[]).length;
    const d = dnaMap[m.hospitalId];
    const siteType = d ? d.site_type : '-';

    let status = '';
    if (pages >= 5 && docCount > 0) status = '✅';
    else if (pages >= 5) status = '⚠️';
    else if (pages > 0) status = '🟡';
    else status = '❌';

    console.log(`│  ${status} #${String(m.no).padEnd(3)} ${m.name.padEnd(18)} ${String(pages).padStart(3)}p   ${String(docCount).padStart(2)}명   ${siteType}`);
  }
  console.log('└────────────────────────────────────────────────────────────────────┘');

  // 4. 의사 추출 성공 상세
  console.log('');
  console.log('┌─ 4. 의사 추출 성공 병원 상세 ──────────────────────────────────┐');
  for (const m of mapping.sort((a,b) => a.no - b.no)) {
    const d = docMap[m.hospitalId];
    if (d && d.length > 0) {
      console.log(`│  #${m.no} ${m.name}: ${d.length}명 — ${d.map(x => x.name + (x.specialty ? '('+x.specialty+')' : '')).join(', ')}`);
    }
  }
  console.log('└────────────────────────────────────────────────────────────────────┘');

  // 5. 오류 분석
  console.log('');
  console.log('┌─ 5. 오류 유형별 분석 및 대응 방침 ────────────────────────────┐');

  // Type A: 완전 실패 (0 pages)
  const zeroPageHospitals = mapping.filter(m => !pageMap[m.hospitalId]);
  console.log('│');
  console.log('│  [A] 크롤링 완전 실패 (0페이지): ' + zeroPageHospitals.length + '개');
  console.log('│  ─────────────────────────────');

  // Categorize zero-page failures
  const snsUrls = zeroPageHospitals.filter(m => m.url.includes('instagram') || m.url.includes('cafe.naver'));
  const deadSites = zeroPageHospitals.filter(m => !m.url.includes('instagram') && !m.url.includes('cafe.naver'));

  if (snsUrls.length > 0) {
    console.log('│  A-1) SNS/블로그 URL (크롤링 불가): ' + snsUrls.length + '개');
    snsUrls.forEach(m => console.log('│       #' + m.no + ' ' + m.name + ' → ' + m.url));
    console.log('│       📋 원인: Instagram/Naver Cafe는 로그인 벽 + JS 렌더링으로 크롤링 불가');
    console.log('│       📋 대응: 자체 홈페이지 URL 재조사 필요. 없으면 네이버 플레이스/모두닥 프로필로 대체');
  }

  if (deadSites.length > 0) {
    console.log('│  A-2) 사이트 접속 불가/차단: ' + deadSites.length + '개');
    deadSites.forEach(m => console.log('│       #' + m.no + ' ' + m.name + ' → ' + m.url));
    console.log('│       📋 원인: 사이트 폐쇄, SSL 만료, WAF 차단, CloudFlare 보호 등');
    console.log('│       📋 대응: 1) URL 유효성 수동 확인 2) Firecrawl stealth 모드 재시도 3) 실패시 네이버 플레이스 대체');
  }

  // Type B: 부분 크롤링 (1-4 pages)
  const partialHospitals = mapping.filter(m => { const c = pageMap[m.hospitalId]||0; return c >= 1 && c < 5; });
  console.log('│');
  console.log('│  [B] 부분 크롤링 (1-4페이지): ' + partialHospitals.length + '개');
  console.log('│  ─────────────────────────────');
  partialHospitals.sort((a,b) => a.no - b.no).forEach(m => {
    const pages = pageMap[m.hospitalId] || 0;
    console.log('│       #' + m.no + ' ' + m.name + ': ' + pages + '페이지 → ' + m.url);
  });
  console.log('│       📋 원인: SPA(React/Vue), 리다이렉트, robots.txt 차단, 서브도메인 분리');
  console.log('│       📋 대응: 1) sitemap.xml 확인 2) 서브페이지 URL 수동 추가 3) Firecrawl JS 렌더링 모드');

  // Type C: 의사 추출 실패
  const noDocHospitals = mapping.filter(m => (pageMap[m.hospitalId]||0) >= 5 && (docMap[m.hospitalId]||[]).length === 0);
  console.log('│');
  console.log('│  [C] 크롤링 성공 but 의사 미추출 (5p+ & 0의사): ' + noDocHospitals.length + '개');
  console.log('│  ─────────────────────────────');
  noDocHospitals.sort((a,b) => a.no - b.no).forEach(m => {
    const pages = pageMap[m.hospitalId] || 0;
    const d = dnaMap[m.hospitalId];
    const hasDocPage = d ? d.has_doctor_page : false;
    console.log('│       #' + m.no + ' ' + m.name + ': ' + pages + 'p, 의사페이지=' + (hasDocPage ? 'Y' : 'N'));
  });
  console.log('│       📋 원인: 의사 소개가 이미지에만 존재, 비정형 레이아웃, 또는 의사 소개 페이지 자체 부재');
  console.log('│       📋 대응: 1) OCR Pass 2 결과에서 재추출 2) 네이버 플레이스/모두닥에서 보완 크롤링');

  // Type D: 장비/시술 데이터 갭
  const eqLossHospitals = inDb.filter(m => {
    const me = master.find(x => x.no === m.no);
    return me && (me.eq_count > 0 || me.tr_count > 0);
  });
  console.log('│');
  console.log('│  [D] 장비/시술 데이터 구조적 갭: ' + eqLossHospitals.length + '개');
  console.log('│  ─────────────────────────────');
  console.log('│       ⚠️ SCV의 upsertCrawlSnapshot()이 equipments_found/treatments_found를');
  console.log('│       저장하지 않는 구조적 결함. Pass 3에서 추출은 하지만 DB 반영 안 됨.');
  console.log('│       기존 마스터의 eq_count/tr_count는 recrawl-v5 시스템(madmedsales)에서 수집된 것.');
  eqLossHospitals.sort((a,b) => a.no - b.no).forEach(m => {
    const me = master.find(x => x.no === m.no);
    console.log('│       #' + m.no + ' ' + m.name + ': 장비 ' + (me.eq_count||0) + '개, 시술 ' + (me.tr_count||0) + '개 (마스터 데이터)');
  });
  console.log('│       📋 근본원인: SCV index.ts의 upsertCrawlSnapshot() 함수 (line ~366, ~1002)가');
  console.log('│           equipments_found, treatments_found 필드를 전달하지 않음');
  console.log('│       📋 대응: ');
  console.log('│           [긴급] SCV index.ts 수정 — Pass 3 추출 결과를 snapshot에 저장하도록 패치');
  console.log('│           [대안] 크롤링된 markdown에서 별도 추출 스크립트로 장비/시술 데이터 재추출');

  console.log('│');
  console.log('└────────────────────────────────────────────────────────────────────┘');

  // 6. 사이트 유형 분석
  console.log('');
  console.log('┌─ 6. 사이트 유형별 크롤링 성공률 ──────────────────────────────┐');
  const typeStats = {};
  for (const m of mapping) {
    const d = dnaMap[m.hospitalId];
    const t = d ? d.site_type : 'no_dna';
    if (!typeStats[t]) typeStats[t] = { total: 0, good: 0, partial: 0, fail: 0 };
    typeStats[t].total++;
    const p = pageMap[m.hospitalId] || 0;
    if (p >= 5) typeStats[t].good++;
    else if (p >= 1) typeStats[t].partial++;
    else typeStats[t].fail++;
  }

  console.log('│  유형           전체  양호  부분  실패  성공률');
  console.log('│  ──────────── ───── ───── ───── ───── ──────');
  for (const [type, s] of Object.entries(typeStats).sort((a,b) => b[1].total - a[1].total)) {
    const rate = Math.round(s.good / s.total * 100);
    console.log(`│  ${type.padEnd(14)} ${String(s.total).padStart(3)}   ${String(s.good).padStart(3)}   ${String(s.partial).padStart(3)}   ${String(s.fail).padStart(3)}   ${rate}%`);
  }
  console.log('└────────────────────────────────────────────────────────────────────┘');

  // 7. 대응 우선순위
  console.log('');
  console.log('┌─ 7. 대응 우선순위 로드맵 ─────────────────────────────────────┐');
  console.log('│');
  console.log('│  🔴 P0 (즉시) SCV 장비/시술 저장 패치');
  console.log('│     → index.ts upsertCrawlSnapshot에 equipments_found, treatments_found 추가');
  console.log('│     → 패치 후 61개 병원 재크롤링 (Pass 3만 재실행하면 충분)');
  console.log('│');
  console.log('│  🟠 P1 (이번 주) 0페이지 실패 12개 병원 URL 재조사');
  console.log('│     → SNS URL 2개: 자체 홈페이지 존재 여부 확인');
  console.log('│     → 사이트 불가 10개: 수동 접속 테스트 + 대체 URL 확보');
  console.log('│');
  console.log('│  🟡 P2 (이번 주) 부분 크롤링 14개 병원 보완');
  console.log('│     → sitemap.xml / 서브페이지 URL 수동 추가');
  console.log('│     → SPA 사이트는 Firecrawl JS 렌더링 모드 시도');
  console.log('│');
  console.log('│  🟢 P3 (다음 주) 의사 미추출 병원 보완');
  console.log('│     → OCR 결과에서 재추출 시도');
  console.log('│     → 네이버 플레이스/모두닥 보완 크롤링');
  console.log('│');
  console.log('└────────────────────────────────────────────────────────────────────┘');
}

run().catch(e => { console.error(e); process.exit(1); });
