/**
 * batch-selector.ts — 일일 배치 대상 병원 선택기
 *
 * 우선순위:
 *   1. 이전 배치에서 ERROR/TIMEOUT된 병원 (재시도, 최대 2회)
 *   2. 아직 크롤링 안 된 병원 (created_at 순)
 *   3. 이전 크롤링이 오래된 병원 (갱신)
 *
 * 제외:
 *   - 이미 PASS인 병원 (scv_crawl_validations.status = 'pass')
 *   - 3회 연속 INSUFFICIENT인 병원
 *   - 수동 제외 목록에 있는 병원
 *
 * Usage:
 *   npx tsx scripts/batch-selector.ts --count 100 --output output/logs/batch_20260301/targets.json
 *   npx tsx scripts/batch-selector.ts --count 50 --phase 1 --dry-run
 *   npx tsx scripts/batch-selector.ts --count 100 --phase 1 --sigungu 강남구
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from './utils/supabase.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ============================================================
// 타입 정의
// ============================================================
interface HospitalTarget {
  hospitalId: string;
  name: string;
  region: string | null;
  url: string;
  priority: 'S' | 'A' | 'B' | 'C' | 'D';
  reason: 'retry_error' | 'retry_timeout' | 'new' | 'stale';
  retryCount: number;
  skip_reason?: 'duplicate_url';
  /** duplicate_url인 경우, 대표 병원 ID */
  dedup_representative?: string;
}

/** URL 그룹 정보 (중복 URL 병원 묶음) */
interface DedupGroup {
  normalizedUrl: string;
  representative: HospitalTarget;
  duplicates: HospitalTarget[];
}

interface BatchConfig {
  date: string;
  count: number;
  phase: number;
  targets: HospitalTarget[];
  skippedDuplicates: HospitalTarget[];
  stats: {
    retryError: number;
    retryTimeout: number;
    newHospitals: number;
    staleHospitals: number;
    dedupGroups: number;
    dedupSkipped: number;
    blogSkipped: number;
  };
}

// ============================================================
// URL 정규화 + 중복 제거
// ============================================================

/** URL 정규화: http/https 통일, www 제거, 끝 슬래시 제거, 소문자 */
function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = u.pathname.replace(/\/+$/, '') || '';
    return `${host}${pathname}`;
  } catch {
    // URL 파싱 실패 시 단순 정규화
    return url
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}

/** 배치 대상 중 동일 URL 병원을 그룹핑하고 대표 1개만 남김 */
function deduplicateByUrl(targets: HospitalTarget[]): {
  crawlTargets: HospitalTarget[];
  skippedTargets: HospitalTarget[];
  groups: DedupGroup[];
} {
  // normalizedUrl → 같은 URL을 가진 HospitalTarget[]
  const urlGroups = new Map<string, HospitalTarget[]>();
  for (const t of targets) {
    const key = normalizeUrl(t.url);
    const list = urlGroups.get(key) ?? [];
    list.push(t);
    urlGroups.set(key, list);
  }

  const crawlTargets: HospitalTarget[] = [];
  const skippedTargets: HospitalTarget[] = [];
  const groups: DedupGroup[] = [];

  for (const [normalizedUrl, members] of urlGroups) {
    if (members.length === 1) {
      crawlTargets.push(members[0]);
      continue;
    }

    // 대표 선정: 우선순위 높은 것 > retry 우선 > 이름 짧은 것
    const priorityOrder: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4 };
    members.sort((a, b) => {
      const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (pDiff !== 0) return pDiff;
      return a.name.length - b.name.length;
    });

    const representative = members[0];
    const duplicates = members.slice(1);

    crawlTargets.push(representative);

    for (const dup of duplicates) {
      dup.skip_reason = 'duplicate_url';
      dup.dedup_representative = representative.hospitalId;
      skippedTargets.push(dup);
    }

    groups.push({ normalizedUrl, representative, duplicates });

    console.log(
      `  [DEDUP] ${normalizedUrl} → ${members.length}개 병원 감지, ` +
      `대표: ${representative.name}, ` +
      `공유: ${duplicates.map(d => d.name).join(', ')}`
    );
  }

  return { crawlTargets, skippedTargets, groups };
}

// ============================================================
// 수동 제외 목록
// ============================================================
const EXCLUDED_HOSPITALS_PATH = path.resolve(__dirname, 'data', 'batch-excluded.json');

function loadExcludedIds(): Set<string> {
  if (!fs.existsSync(EXCLUDED_HOSPITALS_PATH)) return new Set();
  const data: string[] = JSON.parse(fs.readFileSync(EXCLUDED_HOSPITALS_PATH, 'utf-8'));
  return new Set(data);
}

// ============================================================
// Phase별 지역 필터
// ============================================================
const PHASE_REGIONS: Record<number, string[]> = {
  1: ['서울'], // 워밍업: 서울 주요 지역
  2: ['서울', '경기', '인천'], // 수도권
  3: ['부산', '대구', '광주', '대전', '울산', '세종'], // 광역시
  4: [], // 전국 (필터 없음 = 나머지 전부)
};

// 우선순위 매핑 (지역 기반 — DB: sido, sigungu, address)
function assignPriority(sido: string | null, sigungu: string | null, address: string | null): HospitalTarget['priority'] {
  if (!sido && !address) return 'D';
  const combined = `${sido ?? ''} ${sigungu ?? ''} ${address ?? ''}`;
  if (/강남|서초|압구정|청담|신사/.test(combined)) return 'A';
  if (/서울/.test(combined)) return 'B';
  if (/경기|인천|부산|대구|광주|대전|울산|세종/.test(combined)) return 'C';
  return 'D';
}

// ============================================================
// DB 조회 함수들
// ============================================================

/** 이전 배치에서 ERROR/TIMEOUT 된 병원 (재시도 대상) */
async function getRetryTargets(excludedIds: Set<string>): Promise<HospitalTarget[]> {
  // scv_crawl_validations에서 status = 'error' 또는 'timeout'인 병원
  const { data: validations, error: vErr } = await supabase
    .from('scv_crawl_validations')
    .select('hospital_id, status')
    .in('status', ['error', 'timeout', 'fail'])
    .order('validated_at', { ascending: false });

  if (vErr || !validations) {
    console.log(`  ⚠️ 재시도 대상 조회 실패: ${vErr?.message}`);
    return [];
  }

  // 같은 hospital_id가 여러 번 있을 수 있으므로, 최신 것만 & 횟수 카운트
  const retryCounts = new Map<string, number>();
  const statusMap = new Map<string, string>();
  for (const row of validations) {
    const hId = row.hospital_id as string;
    retryCounts.set(hId, (retryCounts.get(hId) ?? 0) + 1);
    if (!statusMap.has(hId)) statusMap.set(hId, row.status as string);
  }

  // 2회 이하 재시도 대상만 선별
  const retryIds: string[] = [];
  for (const [hId, count] of retryCounts.entries()) {
    if (count <= 2 && !excludedIds.has(hId)) retryIds.push(hId);
  }

  if (retryIds.length === 0) return [];

  // 병원 정보 조회
  const { data: hospitals, error: hErr } = await supabase
    .from('hospitals')
    .select('id, name, website, sido, sigungu, address')
    .in('id', retryIds);

  if (hErr || !hospitals) return [];

  const targets: HospitalTarget[] = [];
  for (const h of hospitals) {
    const hId = h.id as string;
    if (!h.website) continue;
    const status = statusMap.get(hId) ?? 'error';

    targets.push({
      hospitalId: hId,
      name: h.name as string,
      region: (h.sido as string) ?? null,
      url: h.website as string,
      priority: assignPriority(
        (h.sido as string) ?? null,
        (h.sigungu as string) ?? null,
        (h.address as string) ?? null
      ),
      reason: status === 'timeout' ? 'retry_timeout' : 'retry_error',
      retryCount: retryCounts.get(hId) ?? 1,
    });
  }

  return targets;
}

/** 아직 크롤링 안 된 병원 (hospitals 테이블에 있지만 scv_crawl_validations에 없는 병원) */
async function getNewTargets(
  excludedIds: Set<string>,
  alreadySelectedIds: Set<string>,
  phaseRegions: string[],
  limit: number,
  sigunguFilter?: string,
): Promise<HospitalTarget[]> {
  // 피부과 → 성형외과 → null 순으로 우선 선택
  // 각 department별로 쿼리 분리하여 피부과 우선 확보
  const deptOrder = ['피부과', '성형외과'] as const;
  let hospitals: typeof rawHospitals = [];
  let rawHospitals: { id: unknown; name: unknown; website: unknown; sido: unknown; sigungu: unknown; address: unknown; department: unknown }[] = [];

  for (const dept of deptOrder) {
    let query = supabase
      .from('hospitals')
      .select('id, name, website, sido, sigungu, address, department')
      .not('website', 'is', null)
      .eq('department', dept);
    if (sigunguFilter) query = query.eq('sigungu', sigunguFilter);
    const { data, error } = await query
      .order('name', { ascending: true })
      .limit(sigunguFilter ? limit * 20 : limit * 5);
    if (!error && data) rawHospitals.push(...data);
  }
  // null department (기존 파일럿) 마지막
  let nullQuery = supabase
    .from('hospitals')
    .select('id, name, website, sido, sigungu, address, department')
    .not('website', 'is', null)
    .is('department', null);
  if (sigunguFilter) nullQuery = nullQuery.eq('sigungu', sigunguFilter);
  const { data: nullDeptData, error: nullErr } = await nullQuery
    .order('name', { ascending: true })
    .limit(sigunguFilter ? limit * 20 : limit * 2);
  if (!nullErr && nullDeptData) rawHospitals.push(...nullDeptData);
  hospitals = rawHospitals;

  // 크롤링 불가 URL 제외 (youtube, kakao pf, instagram, short link 등)
  const UNCRAWLABLE_URL = /youtube\.com|instagram\.com|pf\.kakao\.com|short\.ddocdoc\.com|place\.map/i;
  hospitals = hospitals.filter(h => !UNCRAWLABLE_URL.test(String(h.website)));

  // 이름 기반 분류 (DB department가 부정확할 수 있으므로)
  const SKIN_KEYWORDS = /피부|성형|에스테틱|뷰티|리프팅|보톡스|필러|레이저|스킨|더마|derm|skin|beauty|plastic/i;
  const NON_SKIN_NAME = /정형외과|내과의원|소아|치과|한의원|한방|안과|이비인후|비뇨|산부인과|신경외과|재활의학|요양|검진센터/i;

  hospitals.sort((a, b) => {
    const nameA = String(a.name);
    const nameB = String(b.name);

    // 이름에 비관련 과목이 있으면 맨 뒤로
    const aNonSkin = NON_SKIN_NAME.test(nameA) && !SKIN_KEYWORDS.test(nameA);
    const bNonSkin = NON_SKIN_NAME.test(nameB) && !SKIN_KEYWORDS.test(nameB);
    if (aNonSkin !== bNonSkin) return aNonSkin ? 1 : -1;

    // 1순위: 이름에 피부/성형 키워드 → 앞으로
    const aHasSkin = SKIN_KEYWORDS.test(nameA) ? 0 : 1;
    const bHasSkin = SKIN_KEYWORDS.test(nameB) ? 0 : 1;
    if (aHasSkin !== bHasSkin) return aHasSkin - bHasSkin;

    // 2순위: department (피부과 > 성형외과 > null)
    const deptRank = (d: unknown): number => d === '피부과' ? 0 : d === '성형외과' ? 1 : 2;
    return deptRank(a.department) - deptRank(b.department);
  });

  const hErr = null; // 에러는 개별 쿼리에서 처리됨
  if (hErr || !hospitals) {
    console.log(`  ⚠️ 병원 목록 조회 실패: ${hErr?.message}`);
    return [];
  }

  // 이미 크롤링된 hospital_id 세트 가져오기
  const { data: crawled } = await supabase
    .from('scv_crawl_validations')
    .select('hospital_id');
  const crawledIds = new Set((crawled ?? []).map(c => c.hospital_id as string));

  const targets: HospitalTarget[] = [];
  for (const h of hospitals) {
    const hId = h.id as string;
    if (excludedIds.has(hId) || alreadySelectedIds.has(hId) || crawledIds.has(hId)) continue;
    if (!h.website) continue;

    // Phase별 지역 필터 (코드 후처리 — .or() 중복 방지)
    if (phaseRegions.length > 0) {
      const sido = (h.sido as string) ?? '';
      if (!phaseRegions.some(r => sido.includes(r))) continue;
    }

    // sigungu 필터 (--sigungu 옵션)
    if (sigunguFilter) {
      const sigungu = (h.sigungu as string) ?? '';
      if (sigungu !== sigunguFilter) continue;
    }

    // 피부과/성형외과가 아닌 비관련 과목 병원 제외 (null department 중)
    const nameStr = String(h.name);
    const NON_SKIN_DEPT = /정형외과|내과|소아|치과|한의원|한방|안과|이비인후과|비뇨|산부인과|신경외과|재활|요양|검진/i;
    if (h.department == null && NON_SKIN_DEPT.test(nameStr) && !SKIN_KEYWORDS.test(nameStr)) {
      continue; // 피부시술 무관 병원 스킵
    }

    targets.push({
      hospitalId: hId,
      name: h.name as string,
      region: (h.sido as string) ?? null,
      url: h.website as string,
      priority: assignPriority(
        (h.sido as string) ?? null,
        (h.sigungu as string) ?? null,
        (h.address as string) ?? null
      ),
      reason: 'new',
      retryCount: 0,
    });

    if (targets.length >= limit) break;
  }

  return targets;
}

/** 이전 크롤링이 오래된 병원 (30일+ 경과) */
async function getStaleTargets(
  excludedIds: Set<string>,
  alreadySelectedIds: Set<string>,
  limit: number,
): Promise<HospitalTarget[]> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('hospitals')
    .select('id, name, website, sido, sigungu, address, crawled_at')
    .not('website', 'is', null)
    .or('department.eq.피부과,department.eq.성형외과,department.is.null')
    .lt('crawled_at', thirtyDaysAgo)
    .order('crawled_at', { ascending: true })
    .limit(limit * 2);

  if (error || !data) {
    console.log(`  ⚠️ 갱신 대상 조회 실패: ${error?.message}`);
    return [];
  }

  // PASS인 병원만 갱신 대상 (이미 성공한 데이터 최신화)
  const { data: passHospitals } = await supabase
    .from('scv_crawl_validations')
    .select('hospital_id')
    .eq('status', 'pass');
  const passIds = new Set((passHospitals ?? []).map(p => p.hospital_id as string));

  const targets: HospitalTarget[] = [];
  for (const h of data) {
    const hId = h.id as string;
    if (excludedIds.has(hId) || alreadySelectedIds.has(hId)) continue;
    if (!passIds.has(hId)) continue; // PASS인 것만 갱신
    if (!h.website) continue;

    targets.push({
      hospitalId: hId,
      name: h.name as string,
      region: (h.sido as string) ?? null,
      url: h.website as string,
      priority: assignPriority(
        (h.sido as string) ?? null,
        (h.sigungu as string) ?? null,
        (h.address as string) ?? null
      ),
      reason: 'stale',
      retryCount: 0,
    });

    if (targets.length >= limit) break;
  }

  return targets;
}

/** 3회 연속 INSUFFICIENT인 병원 제외 */
async function getInsufficientBlocklist(): Promise<Set<string>> {
  // scv_crawl_validations에서 같은 hospital_id로 3회 이상 'insufficient' 상태인 병원
  const { data, error } = await supabase
    .from('scv_crawl_validations')
    .select('hospital_id, status')
    .eq('status', 'insufficient');

  if (error || !data) return new Set();

  const counts = new Map<string, number>();
  for (const row of data) {
    const hId = row.hospital_id as string;
    counts.set(hId, (counts.get(hId) ?? 0) + 1);
  }

  const blocked = new Set<string>();
  for (const [hId, count] of counts) {
    if (count >= 3) blocked.add(hId);
  }

  return blocked;
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const countIdx = args.indexOf('--count');
  const count = countIdx >= 0 ? parseInt(args[countIdx + 1]) : 100;

  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx >= 0 ? args[outputIdx + 1] : undefined;

  const phaseIdx = args.indexOf('--phase');
  const phase = phaseIdx >= 0 ? parseInt(args[phaseIdx + 1]) : 2; // default: Phase 2

  const dryRun = args.includes('--dry-run');

  const sigunguIdx = args.indexOf('--sigungu');
  const sigunguFilter = sigunguIdx >= 0 ? args[sigunguIdx + 1] : undefined;

  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  console.log('═══════════════════════════════════════════════════');
  console.log('  batch-selector: 일일 배치 대상 선택');
  console.log('═══════════════════════════════════════════════════\n');
  console.log(`  날짜: ${date} | 목표: ${count}개 | Phase: ${phase}${sigunguFilter ? ` | 지역: ${sigunguFilter}` : ''}${dryRun ? ' | DRY RUN' : ''}`);

  // 제외 목록 로드
  const manualExcluded = loadExcludedIds();
  const insufficientBlocked = await getInsufficientBlocklist();
  const excludedIds = new Set([...manualExcluded, ...insufficientBlocked]);
  console.log(`  제외: 수동 ${manualExcluded.size}개 + INSUFFICIENT 3회+ ${insufficientBlocked.size}개 = ${excludedIds.size}개\n`);

  const phaseRegions = PHASE_REGIONS[phase] ?? [];
  const selectedIds = new Set<string>();
  const allTargets: HospitalTarget[] = [];

  // 1단계: 재시도 대상 (ERROR/TIMEOUT)
  console.log('  [1/3] 재시도 대상 조회...');
  const retryTargets = await getRetryTargets(excludedIds);
  for (const t of retryTargets) {
    if (allTargets.length >= count) break;
    allTargets.push(t);
    selectedIds.add(t.hospitalId);
  }
  const retryErrorCount = allTargets.filter(t => t.reason === 'retry_error').length;
  const retryTimeoutCount = allTargets.filter(t => t.reason === 'retry_timeout').length;
  console.log(`    재시도: ERROR ${retryErrorCount}개 + TIMEOUT ${retryTimeoutCount}개`);

  // 2단계: 새 병원
  const remaining1 = count - allTargets.length;
  if (remaining1 > 0) {
    console.log(`  [2/3] 신규 병원 조회 (${remaining1}개 필요)...`);
    const newTargets = await getNewTargets(excludedIds, selectedIds, phaseRegions, remaining1, sigunguFilter);
    for (const t of newTargets) {
      if (allTargets.length >= count) break;
      allTargets.push(t);
      selectedIds.add(t.hospitalId);
    }
    console.log(`    신규: ${allTargets.length - retryErrorCount - retryTimeoutCount}개`);
  }

  // 3단계: 갱신 대상 (30일+ 경과 PASS 병원)
  const remaining2 = count - allTargets.length;
  if (remaining2 > 0) {
    console.log(`  [3/3] 갱신 대상 조회 (${remaining2}개 필요)...`);
    const staleTargets = await getStaleTargets(excludedIds, selectedIds, remaining2);
    for (const t of staleTargets) {
      if (allTargets.length >= count) break;
      allTargets.push(t);
      selectedIds.add(t.hospitalId);
    }
  }
  const staleCount = allTargets.filter(t => t.reason === 'stale').length;
  const newCount = allTargets.filter(t => t.reason === 'new').length;

  // 우선순위 정렬: S > A > B > C > D, 같은 순위면 retry 우선
  const priorityOrder2 = { S: 0, A: 1, B: 2, C: 3, D: 4 };
  const reasonOrder = { retry_error: 0, retry_timeout: 1, new: 2, stale: 3 };
  allTargets.sort((a, b) => {
    const pDiff = priorityOrder2[a.priority] - priorityOrder2[b.priority];
    if (pDiff !== 0) return pDiff;
    return reasonOrder[a.reason] - reasonOrder[b.reason];
  });

  // 블로그 병원: 네이버 블로그 크롤링 지원 추가 (v5.6) → 스킵 없이 포함
  const blogSkipped = 0;

  // URL 중복 제거
  console.log('\n  [DEDUP] 동일 URL 중복 검사...');
  const { crawlTargets, skippedTargets, groups } = deduplicateByUrl(allTargets);

  if (groups.length === 0) {
    console.log('    중복 없음');
  } else {
    console.log(`    ${groups.length}개 그룹에서 ${skippedTargets.length}개 병원 스킵 처리`);
  }

  // 결과 출력
  const config: BatchConfig = {
    date,
    count: crawlTargets.length,
    phase,
    targets: crawlTargets,
    skippedDuplicates: skippedTargets,
    stats: {
      retryError: retryErrorCount,
      retryTimeout: retryTimeoutCount,
      newHospitals: newCount,
      staleHospitals: staleCount,
      dedupGroups: groups.length,
      dedupSkipped: skippedTargets.length,
      blogSkipped,
    },
  };

  console.log(`\n  ────────────────────────────────────────`);
  console.log(`  총 선택: ${config.count}개 (크롤링 대상)`);
  console.log(`    재시도(ERROR):   ${config.stats.retryError}개`);
  console.log(`    재시도(TIMEOUT): ${config.stats.retryTimeout}개`);
  console.log(`    신규:            ${config.stats.newHospitals}개`);
  console.log(`    갱신:            ${config.stats.staleHospitals}개`);
  if (config.stats.dedupGroups > 0) {
    console.log(`    중복URL 스킵:    ${config.stats.dedupSkipped}개 (${config.stats.dedupGroups}그룹)`);
  }
  if (config.stats.blogSkipped > 0) {
    console.log(`    블로그/카페 스킵: ${config.stats.blogSkipped}개`);
  }
  console.log(`  ────────────────────────────────────────`);

  if (dryRun) {
    console.log('\n  [DRY RUN] 크롤링 대상:');
    for (let i = 0; i < crawlTargets.length; i++) {
      const t = crawlTargets[i];
      console.log(`    ${i + 1}. [${t.priority}] ${t.name} (${t.reason}${t.retryCount > 0 ? `, retry #${t.retryCount}` : ''}) — ${normalizeUrl(t.url)}`);
    }
    if (skippedTargets.length > 0) {
      console.log('\n  [DRY RUN] 중복 스킵 (대표 병원 결과 공유 예정):');
      for (const t of skippedTargets) {
        const repName = crawlTargets.find(c => c.hospitalId === t.dedup_representative)?.name ?? t.dedup_representative;
        console.log(`    ↳ ${t.name} → 대표: ${repName} (${normalizeUrl(t.url)})`);
      }
    }
    process.exit(0);
  }

  // JSON 저장
  if (outputPath) {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(config, null, 2));
    console.log(`\n  📄 저장: ${outputPath}`);
  } else {
    // 기본 경로
    const defaultDir = path.resolve(__dirname, '..', 'output', 'logs', `batch_${date}`);
    if (!fs.existsSync(defaultDir)) fs.mkdirSync(defaultDir, { recursive: true });
    const defaultPath = path.join(defaultDir, 'targets.json');
    fs.writeFileSync(defaultPath, JSON.stringify(config, null, 2));
    console.log(`\n  📄 저장: ${defaultPath}`);
  }

  console.log('  ✅ batch-selector 완료');
}

main().catch(err => {
  console.error('❌ batch-selector 실패:', err);
  process.exit(1);
});
