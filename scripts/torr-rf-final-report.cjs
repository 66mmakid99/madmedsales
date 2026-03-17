const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'madmedscv', 'scripts', 'torr-rf-db-snapshot.json'), 'utf-8'));
const targets = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'data', 'torr-rf-crawl-targets.json'), 'utf-8'));

// Merge URL info
for (const d of data) {
  const t = targets.find(x => x.no === d.no);
  if (t) d.url = t.url;
}

const total = data.length;
const good = data.filter(d => d.pages >= 5).length;
const partial = data.filter(d => d.pages >= 1 && d.pages < 5).length;
const failed = data.filter(d => d.pages === 0).length;
const withDocs = data.filter(d => d.doctors > 0).length;
const totalDocs = data.reduce((s, d) => s + d.doctors, 0);
const inDb = data.filter(d => d.in_db);
const newOnes = data.filter(d => !d.in_db);

console.log('');
console.log('╔══════════════════════════════════════════════════════════════════════╗');
console.log('║  TORR RF 기고객 61개 병원 SCV 크롤링 결과 보고서                    ║');
console.log('║  ' + new Date().toISOString().split('T')[0] + '                                                          ║');
console.log('╚══════════════════════════════════════════════════════════════════════╝');

console.log('');
console.log('┌─ 1. 크롤링 결과 요약 ──────────────────────────────────────────────┐');
console.log('│  전체 대상:       ' + total + '개 병원');
console.log('│  양호 (5p+):      ' + good + '개 (' + Math.round(good/total*100) + '%)');
console.log('│  부분 (1-4p):     ' + partial + '개 (' + Math.round(partial/total*100) + '%)');
console.log('│  실패 (0p):       ' + failed + '개 (' + Math.round(failed/total*100) + '%)');
console.log('│  의사 추출 성공:   ' + withDocs + '개 병원, 총 ' + totalDocs + '명');
console.log('│  기존 DB 병원:     ' + inDb.length + '개 / 신규: ' + newOnes.length + '개');
console.log('└──────────────────────────────────────────────────────────────────────┘');

// 2. 기존 DB 병원 비교
console.log('');
console.log('┌─ 2. 기존 DB 병원 (' + inDb.length + '개) — 크롤링 결과 ─────────────────────────┐');
console.log('│  No  병원명               pages  의사  장비(M) 시술(M) siteType');
console.log('│  ─── ────────────────────  ─────  ────  ──────  ──────  ─────────');
for (const r of inDb.sort((a,b) => a.no - b.no)) {
  let icon = '❌';
  if (r.pages >= 5 && r.doctors > 0) icon = '✅';
  else if (r.pages >= 5) icon = '⚠️';
  else if (r.pages > 0) icon = '🟡';

  const docNames = r.doctors > 0 ? ' (' + r.doctorNames.slice(0,3).join(',') + ')' : '';
  console.log('│  ' + icon + ' #' + String(r.no).padEnd(3) + ' ' +
    r.name.padEnd(20) +
    String(r.pages).padStart(3) + 'p  ' +
    String(r.doctors).padStart(3) + '명' + docNames.padEnd(20) +
    String(r.eq_count_master).padStart(3) + '개  ' +
    String(r.tr_count_master).padStart(3) + '개   ' +
    (r.siteType || '-'));
}
console.log('└──────────────────────────────────────────────────────────────────────┘');

// 3. 신규 병원
console.log('');
console.log('┌─ 3. 신규 병원 (' + newOnes.length + '개) — 크롤링 결과 ────────────────────────────┐');
console.log('│  No  병원명               pages  의사  siteType');
console.log('│  ─── ────────────────────  ─────  ────  ─────────');
for (const r of newOnes.sort((a,b) => a.no - b.no)) {
  let icon = '❌';
  if (r.pages >= 5 && r.doctors > 0) icon = '✅';
  else if (r.pages >= 5) icon = '⚠️';
  else if (r.pages > 0) icon = '🟡';

  const docNames = r.doctors > 0 ? ' (' + r.doctorNames.slice(0,3).join(',') + ')' : '';
  console.log('│  ' + icon + ' #' + String(r.no).padEnd(3) + ' ' +
    r.name.padEnd(20) +
    String(r.pages).padStart(3) + 'p  ' +
    String(r.doctors).padStart(3) + '명' + docNames);
}
console.log('└──────────────────────────────────────────────────────────────────────┘');

// 4. 의사 추출 성공 상세
console.log('');
console.log('┌─ 4. 의사 추출 성공 병원 상세 (' + withDocs + '개) ──────────────────────────┐');
for (const r of data.filter(d => d.doctors > 0).sort((a,b) => a.no - b.no)) {
  console.log('│  #' + String(r.no).padEnd(3) + ' ' + r.name + ': ' + r.doctors + '명 — ' + r.doctorNames.join(', '));
}
console.log('└──────────────────────────────────────────────────────────────────────┘');

// 5. 오류 분석
console.log('');
console.log('┌─ 5. 오류 유형별 분석 및 대응 방침 ─────────────────────────────────┐');

// A. 완전 실패
const zeroPage = data.filter(d => d.pages === 0);
const snsUrls = zeroPage.filter(d => d.url && (d.url.includes('instagram') || d.url.includes('cafe.naver') || d.url.includes('blog.naver')));
const deadSites = zeroPage.filter(d => !snsUrls.includes(d));

console.log('│');
console.log('│  [A] 크롤링 완전 실패 (0페이지): ' + zeroPage.length + '개');
console.log('│  ─────────────────────────────');

if (snsUrls.length > 0) {
  console.log('│  A-1) SNS/블로그 URL (크롤링 불가): ' + snsUrls.length + '개');
  for (const d of snsUrls) console.log('│       #' + d.no + ' ' + d.name + ' → ' + d.url);
  console.log('│       📋 원인: Instagram/Naver는 로그인 벽 + JS 렌더링으로 크롤링 불가');
  console.log('│       📋 대응: 자체 홈페이지 URL 재조사. 없으면 네이버 플레이스/모두닥으로 대체');
}

if (deadSites.length > 0) {
  console.log('│  A-2) 사이트 접속 불가/차단: ' + deadSites.length + '개');
  for (const d of deadSites) console.log('│       #' + d.no + ' ' + d.name + ' → ' + (d.url || '(URL 없음)'));
  console.log('│       📋 원인: 사이트 폐쇄, SSL 만료, WAF 차단, CloudFlare 보호');
  console.log('│       📋 대응: 1) URL 유효성 수동 확인 2) Firecrawl stealth 모드 재시도');
  console.log('│               3) 실패시 네이버 플레이스 대체');
}

// B. 부분 크롤링
const partials = data.filter(d => d.pages >= 1 && d.pages < 5);
console.log('│');
console.log('│  [B] 부분 크롤링 (1-4페이지): ' + partials.length + '개');
console.log('│  ─────────────────────────────');
for (const d of partials.sort((a,b) => a.no - b.no)) {
  const docInfo = d.doctors > 0 ? ', 의사 ' + d.doctors + '명' : '';
  console.log('│       #' + d.no + ' ' + d.name + ': ' + d.pages + 'p' + docInfo + ' → ' + (d.url || ''));
}
console.log('│       📋 원인: SPA(React/Vue), 리다이렉트, robots.txt, 네이버 예약 URL');
console.log('│       📋 대응: 1) sitemap.xml 확인 2) 실제 홈페이지 URL 확보');
console.log('│               3) SPA → Firecrawl JS 렌더링 모드');

// C. 의사 미추출
const noDoc5p = data.filter(d => d.pages >= 5 && d.doctors === 0);
console.log('│');
console.log('│  [C] 크롤링 성공 but 의사 미추출 (5p+ & 0의사): ' + noDoc5p.length + '개');
console.log('│  ─────────────────────────────');
for (const d of noDoc5p.sort((a,b) => a.no - b.no)) {
  const types = d.pageTypes.join(',');
  console.log('│       #' + d.no + ' ' + d.name + ': ' + d.pages + 'p [' + types + ']');
}
console.log('│       📋 원인: 의사 소개가 이미지에만 존재, 비정형 레이아웃, 소개 페이지 부재');
console.log('│       📋 대응: 1) Pass 2 OCR 결과 재추출 2) 네이버 플레이스/모두닥 보완 크롤링');

// D. 장비/시술 데이터
const eqLoss = data.filter(d => d.in_db && (d.eq_count_master > 0 || d.tr_count_master > 0));
console.log('│');
console.log('│  [D] 장비/시술 데이터 구조적 갭 (기존 데이터 소실): ' + eqLoss.length + '개');
console.log('│  ─────────────────────────────');
let totalEqLost = 0, totalTrLost = 0;
for (const d of eqLoss.sort((a,b) => a.no - b.no)) {
  totalEqLost += d.eq_count_master;
  totalTrLost += d.tr_count_master;
  console.log('│       #' + d.no + ' ' + d.name + ': 장비 ' + d.eq_count_master + '→0, 시술 ' + d.tr_count_master + '→0');
}
console.log('│       총 소실: 장비 ' + totalEqLost + '건, 시술 ' + totalTrLost + '건');
console.log('│');
console.log('│       📋 근본원인:');
console.log('│       SCV index.ts의 upsertCrawlSnapshot()이 equipments_found,');
console.log('│       treatments_found 필드를 전달하지 않는 구조적 결함.');
console.log('│       기존 마스터의 eq_count/tr_count는 recrawl-v5(madmedsales)에서 수집된 것.');
console.log('│');
console.log('│       📋 대응:');
console.log('│       [P0-긴급] SCV index.ts 수정 — Pass 3 결과를 snapshot에 저장');
console.log('│       [대안]   크롤링된 markdown에서 별도 추출 스크립트로 재추출');
console.log('│');
console.log('└──────────────────────────────────────────────────────────────────────┘');

// 6. 사이트 유형별 분석
console.log('');
console.log('┌─ 6. 사이트 유형별 크롤링 성공률 ───────────────────────────────────┐');
const typeStats = {};
for (const d of data) {
  const t = d.siteType || 'unknown';
  if (!typeStats[t]) typeStats[t] = { total: 0, good: 0, partial: 0, fail: 0, docs: 0 };
  typeStats[t].total++;
  typeStats[t].docs += d.doctors;
  if (d.pages >= 5) typeStats[t].good++;
  else if (d.pages >= 1) typeStats[t].partial++;
  else typeStats[t].fail++;
}

console.log('│  유형             전체  양호  부분  실패  의사  성공률');
console.log('│  ────────────── ───── ───── ───── ───── ───── ──────');
for (const [type, s] of Object.entries(typeStats).sort((a,b) => b[1].total - a[1].total)) {
  const rate = s.total > 0 ? Math.round(s.good / s.total * 100) : 0;
  console.log('│  ' + type.padEnd(16) +
    String(s.total).padStart(3) + '   ' +
    String(s.good).padStart(3) + '   ' +
    String(s.partial).padStart(3) + '   ' +
    String(s.fail).padStart(3) + '   ' +
    String(s.docs).padStart(3) + '   ' + rate + '%');
}
console.log('└──────────────────────────────────────────────────────────────────────┘');

// 7. 대응 우선순위
console.log('');
console.log('┌─ 7. 대응 우선순위 로드맵 ──────────────────────────────────────────┐');
console.log('│');
console.log('│  🔴 P0 (즉시) SCV 장비/시술 저장 패치');
console.log('│     → index.ts upsertCrawlSnapshot()에 equipments_found,');
console.log('│       treatments_found 추가');
console.log('│     → 패치 후 61개 병원 Pass 3만 재실행');
console.log('│     → 영향: 장비/시술 데이터 복원 (기존 장비 ' + totalEqLost + '건, 시술 ' + totalTrLost + '건)');
console.log('│');
console.log('│  🟠 P1 (이번 주) 0페이지 실패 ' + zeroPage.length + '개 병원 URL 재조사');
console.log('│     → SNS URL ' + snsUrls.length + '개: 자체 홈페이지 존재 여부 확인');
console.log('│     → 사이트 불가 ' + deadSites.length + '개: 수동 접속 테스트 + 대체 URL');
console.log('│');
console.log('│  🟡 P2 (이번 주) 부분 크롤링 ' + partials.length + '개 병원 보완');
console.log('│     → 네이버 예약/블로그 URL → 실제 홈페이지 URL 재조사');
console.log('│     → SPA 사이트 → Firecrawl JS 렌더링 모드');
console.log('│');
console.log('│  🟢 P3 (다음 주) 의사 미추출 ' + noDoc5p.length + '개 병원 보완');
console.log('│     → OCR 결과에서 재추출');
console.log('│     → 네이버 플레이스/모두닥 보완 크롤링');
console.log('│');
console.log('│  📊 현재 데이터 충분도 (분석 가능 수준)');
console.log('│     축1 병원 프로필: ' + good + '/61 (양호 크롤링 기준)');
console.log('│     축2 장비 포트폴리오: 0/61 (SCV 패치 필요)');
console.log('│     축3 시술 메뉴: 0/61 (SCV 패치 필요)');
console.log('│     축5 온라인 마케팅: ' + good + '/61');
console.log('│     축9 웹사이트 구조: ' + data.filter(d => d.siteType).length + '/61');
console.log('│');
console.log('└──────────────────────────────────────────────────────────────────────┘');
