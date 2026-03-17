/**
 * 주소 기반 병원 매칭 (미매칭 재처리) — 3단계 폴백
 *
 * Stage 1: 도로명+번지 인덱스 (정밀)
 * Stage 2: 동(dong)+이름 유사도 — 동일 동에 같은 이름의 피부과는 없음
 * Stage 3: 시군구+주소 전체 유사도+이름 유사도 복합 점수
 *
 * 실행:
 *   npx tsx scripts/import/match-by-address.ts [--input <xlsx>]
 *   npx tsx scripts/import/match-by-address.ts --verbose
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { readdirSync } from 'fs';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { normalizeHospitalName } from './lib/normalizer.js';
import { generateCandidates } from './lib/name-transformer.js';
import {
  parseAddress,
  addressIndexKey,
  addressIndexKeysNearby,
  addressMatchScore,
  extractDong,
  normalizeAddressStr,
  type ParsedAddress,
} from './lib/address-normalizer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('match-by-address');

// ─── 설정 ─────────────────────────────────────────────
const STAGE1_NAME_THRESH  = 0.60;  // Stage1: 도로명 매칭 후 이름 유사도
const STAGE1_ADDR_THRESH  = 0.60;  // Stage1: 주소 점수 최소값
const STAGE2_NAME_THRESH  = 0.55;  // Stage2: 동 매칭 후 이름 유사도 (동내 동명 병원 없다는 가정)
const STAGE3_COMBO_THRESH = 0.60;  // Stage3: 주소유사도×0.5 + 이름유사도×0.5
const STAGE3_ADDR_MIN     = 0.35;  // Stage3: 주소 유사도 최소값 (너무 다른 주소 차단)
const VERBOSE = process.argv.includes('--verbose');

// ─── 타입 ──────────────────────────────────────────────
interface InputRow {
  rowIndex: number;
  hospitalName: string;
  directorName: string;
  directorEmail: string;
  taxEmail: string;
  phone: string;
  address: string;
  originalStatus: string;
  miMatchReason: string;
}

interface DbHospital {
  id: string;
  name: string;
  normalizedName: string;
  email: string | null;
  doctorName: string | null;
  phone: string | null;
  address: string | null;
  normalizedAddress: string;   // 전체 주소 정규화 문자열
  sido: string | null;
  sigungu: string | null;
  dong: string | null;         // 동/읍/면 추출
  parsedAddress: ParsedAddress;
}

interface MatchResult {
  hospital: DbHospital;
  stage: 1 | 2 | 3;
  addrScore: number;
  nameSim: number;
  comboScore: number;
}

type MatchStatus = 'matched' | 'ambiguous' | 'unmatched';

interface ResultRow {
  rowIndex: number;
  '병원명(엑셀)': string;
  원장명: string;
  이메일: string;
  세금계산서이메일: string;
  전화번호: string;
  주소: string;
  이전상태: string;
  매칭상태: string;
  매칭단계: string;
  주소점수: string;
  이름유사도: string;
  복합점수: string;
  DB병원ID: string;
  DB병원명: string;
  DB주소: string;
  DB시도: string;
  DB시군구: string;
  DB동: string;
  DB이메일: string;
  미매칭사유: string;
}

// ─── 유틸 ─────────────────────────────────────────────
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (Math.max(m, n) > 200) {
    // 긴 문자열: 공통 문자 비율로 근사
    const setA = new Set(a), setB = new Set(b);
    const inter = [...setA].filter(c => setB.has(c)).length;
    return inter / Math.max(setA.size, setB.size);
  }
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return 1 - dp[m][n] / Math.max(m, n);
}

function findLatestFile(dir: string, prefix: string): string | null {
  try {
    const files = readdirSync(dir)
      .filter(f => f.startsWith(prefix) && f.endsWith('.xlsx') && !f.startsWith('~$'))
      .sort().reverse();
    return files.length > 0 ? path.join(dir, files[0]) : null;
  } catch { return null; }
}

// ─── 입력 Excel 파싱 ───────────────────────────────────
function parseInputExcel(filePath: string): InputRow[] {
  log.info(`Reading: ${path.basename(filePath)}`);
  const wb = XLSX.readFile(filePath);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  const result: InputRow[] = [];
  for (const r of rows) {
    const hospitalName = r['병원명(엑셀)']?.toString().trim() ?? '';
    if (!hospitalName) continue;
    const address = r['주소']?.toString().trim() ?? r['주소(엑셀)']?.toString().trim() ?? '';
    if (!address || address.length < 5) continue;

    result.push({
      rowIndex:       Number(r['행번호']) || 0,
      hospitalName,
      directorName:   r['원장명']?.toString().trim() ?? r['원장명(엑셀)']?.toString().trim() ?? '',
      directorEmail:  r['이메일(원장)']?.toString().trim() ?? r['이메일']?.toString().trim() ?? r['이메일(엑셀)']?.toString().trim() ?? '',
      taxEmail:       r['이메일(세금계산서)']?.toString().trim() ?? r['세금계산서이메일']?.toString().trim() ?? '',
      phone:          r['전화번호']?.toString().trim() ?? r['전화번호(엑셀)']?.toString().trim() ?? '',
      address,
      originalStatus: r['매칭상태']?.toString().trim() ?? '미매칭',
      miMatchReason:  r['미매칭사유']?.toString().trim() ?? '',
    });
  }

  log.info(`주소 있는 대상: ${result.length}건`);
  return result;
}

// ─── DB 병원 로드 + 인덱스 빌드 ───────────────────────
interface Indexes {
  hospitals: DbHospital[];
  roadIndex: Map<string, DbHospital[]>;      // "도로명:번지" → 병원목록
  dongIndex: Map<string, DbHospital[]>;      // "시도:시군구:동" → 병원목록
  sigunguIndex: Map<string, DbHospital[]>;   // "시도:시군구" → 병원목록
}

async function loadHospitals(): Promise<Indexes> {
  log.info('병원 DB 로딩...');
  const PAGE_SIZE = 1000;
  const all: DbHospital[] = [];
  let page = 0;

  while (true) {
    const { data, error } = await supabase
      .from('hospitals')
      .select('id, name, email, doctor_name, phone, address, sido, sigungu')
      .eq('status', 'active')
      .in('department', ['피부과', '성형외과'])
      .not('address', 'is', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const h of data) {
      const parsedAddress = parseAddress(h.address ?? '');
      const dong = extractDong(h.address ?? '');
      all.push({
        id: h.id, name: h.name,
        normalizedName: normalizeHospitalName(h.name),
        email: h.email,
        doctorName: h.doctor_name,
        phone: h.phone,
        address: h.address,
        normalizedAddress: normalizeAddressStr(h.address ?? ''),
        sido: h.sido,
        sigungu: h.sigungu,
        dong,
        parsedAddress,
      });
    }

    if (data.length < PAGE_SIZE) break;
    page++;
    if (page % 5 === 0) log.info(`  ${page * PAGE_SIZE}건 로드...`);
  }

  log.info(`총 병원: ${all.length}건`);

  // 인덱스 빌드
  const roadIndex    = new Map<string, DbHospital[]>();
  const dongIndex    = new Map<string, DbHospital[]>();
  const sigunguIndex = new Map<string, DbHospital[]>();
  let roadIndexed = 0;

  for (const h of all) {
    // 도로명 인덱스
    const roadKey = addressIndexKey(h.parsedAddress);
    if (roadKey) {
      if (!roadIndex.has(roadKey)) roadIndex.set(roadKey, []);
      roadIndex.get(roadKey)!.push(h);
      roadIndexed++;
    }

    // 동 인덱스
    const sido     = h.parsedAddress.sido ?? h.sido ?? '';
    const sigungu  = h.parsedAddress.sigungu ?? h.sigungu ?? '';
    const dong     = h.dong ?? '';

    if (sido && sigungu && dong) {
      const dongKey = `${sido}:${sigungu}:${dong}`;
      if (!dongIndex.has(dongKey)) dongIndex.set(dongKey, []);
      dongIndex.get(dongKey)!.push(h);
    }

    // 시군구 인덱스
    if (sido && sigungu) {
      const sgKey = `${sido}:${sigungu}`;
      if (!sigunguIndex.has(sgKey)) sigunguIndex.set(sgKey, []);
      sigunguIndex.get(sgKey)!.push(h);
    }
  }

  log.info(`도로명 인덱스: ${roadIndex.size}키 (${roadIndexed}건)`);
  log.info(`동 인덱스: ${dongIndex.size}키`);
  log.info(`시군구 인덱스: ${sigunguIndex.size}키`);

  return { hospitals: all, roadIndex, dongIndex, sigunguIndex };
}

// ─── 변환 후보 최선 이름 유사도 계산 ─────────────────────
// "홀드의원_서울_강남" → candidates에서 "홀드의원"이 생성됨
// → DB "홀드의원"과 유사도 1.0
function bestNameSim(rawName: string, normalizedName: string, dbNormName: string): number {
  const candidates = generateCandidates(rawName);
  let best = similarity(normalizedName, dbNormName);
  for (const cand of candidates) {
    const s = similarity(normalizeHospitalName(cand.name), dbNormName);
    if (s > best) best = s;
  }
  return best;
}

// ─── Stage 1: 도로명+번지 매칭 ────────────────────────
function stage1Match(
  rawName: string,
  normName: string,
  parsedExcel: ParsedAddress,
  roadIndex: Map<string, DbHospital[]>,
): MatchResult[] {
  const nearbyKeys = addressIndexKeysNearby(parsedExcel);
  if (nearbyKeys.length === 0) return [];

  const seen = new Set<string>();
  const results: MatchResult[] = [];

  for (const key of nearbyKeys) {
    for (const h of roadIndex.get(key) ?? []) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);

      const addrScore = addressMatchScore(parsedExcel, h.parsedAddress);
      if (addrScore < STAGE1_ADDR_THRESH) continue;

      const nameSim = bestNameSim(rawName, normName, h.normalizedName);
      if (nameSim < STAGE1_NAME_THRESH) continue;

      results.push({ hospital: h, stage: 1, addrScore, nameSim, comboScore: (addrScore + nameSim) / 2 });
    }
  }

  return results.sort((a, b) => b.comboScore - a.comboScore);
}

// ─── Stage 2: 동+이름 유사도 매칭 ─────────────────────
function stage2Match(
  rawName: string,
  normName: string,
  parsedExcel: ParsedAddress,
  excelDong: string | null,
  dongIndex: Map<string, DbHospital[]>,
): MatchResult[] {
  if (!excelDong) return [];

  const sido    = parsedExcel.sido ?? '';
  const sigungu = parsedExcel.sigungu ?? '';
  const dongKey = sido && sigungu ? `${sido}:${sigungu}:${excelDong}` : null;
  if (!dongKey) return [];

  const candidates = dongIndex.get(dongKey) ?? [];
  const results: MatchResult[] = [];

  for (const h of candidates) {
    const nameSim = bestNameSim(rawName, normName, h.normalizedName);
    if (nameSim < STAGE2_NAME_THRESH) continue;

    results.push({ hospital: h, stage: 2, addrScore: 0.7, nameSim, comboScore: 0.35 + nameSim * 0.65 });
  }

  return results.sort((a, b) => b.comboScore - a.comboScore);
}

// ─── Stage 3: 시군구+주소전체유사도+이름유사도 ──────────
function stage3Match(
  rawName: string,
  normName: string,
  excelAddrNorm: string,
  parsedExcel: ParsedAddress,
  sigunguIndex: Map<string, DbHospital[]>,
): MatchResult[] {
  const sido    = parsedExcel.sido ?? '';
  const sigungu = parsedExcel.sigungu ?? '';
  if (!sido || !sigungu) return [];

  const sgKey = `${sido}:${sigungu}`;
  const candidates = sigunguIndex.get(sgKey) ?? [];

  const results: MatchResult[] = [];

  for (const h of candidates) {
    const addrScore = similarity(excelAddrNorm, h.normalizedAddress);
    if (addrScore < STAGE3_ADDR_MIN) continue;

    // 이름 유사도는 변환 후보 최선값 사용
    const nameSim = bestNameSim(rawName, normName, h.normalizedName);

    // 이름 유사도 최소값 보장 (주소만 높아도 이름이 너무 다르면 차단)
    if (nameSim < 0.40) continue;

    const comboScore = addrScore * 0.4 + nameSim * 0.6;
    if (comboScore < STAGE3_COMBO_THRESH) continue;

    results.push({ hospital: h, stage: 3, addrScore, nameSim, comboScore });
  }

  return results.sort((a, b) => b.comboScore - a.comboScore);
}

// ─── 후보 → 확정/모호/미매칭 ──────────────────────────
function resolveMatch(candidates: MatchResult[]): { status: MatchStatus; matched: MatchResult | null; reason: string } {
  if (candidates.length === 0) return { status: 'unmatched', matched: null, reason: '후보없음' };
  if (candidates.length === 1) return { status: 'matched', matched: candidates[0], reason: '' };

  const top = candidates[0];
  const second = candidates[1];

  // 1위가 2위보다 복합점수 0.08 이상 앞서면 확정
  if (top.comboScore - second.comboScore >= 0.08) {
    return { status: 'matched', matched: top, reason: '' };
  }

  // 1위 이름 유사도가 매우 높으면 (0.85+) 확정
  if (top.nameSim >= 0.85) {
    return { status: 'matched', matched: top, reason: '' };
  }

  return { status: 'ambiguous', matched: top, reason: `후보${candidates.length}개(최고점${top.comboScore.toFixed(2)})` };
}

// ─── 메인 ─────────────────────────────────────────────
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outputDir = path.resolve(__dirname, '../../output');

  const inputIdx = args.indexOf('--input');
  const inputFile = inputIdx >= 0
    ? args[inputIdx + 1]
    : findLatestFile(outputDir, 'unmatched-emails-');

  if (!inputFile) {
    log.error('입력 파일 없음. unmatched-emails-*.xlsx를 output/에 넣어주세요.');
    process.exit(1);
  }

  log.info(`입력: ${path.basename(inputFile)}`);

  const rows = parseInputExcel(inputFile);
  if (rows.length === 0) { log.warn('처리할 행 없음.'); return; }

  const { roadIndex, dongIndex, sigunguIndex } = await loadHospitals();

  // 통계
  const stageStats = { s1: 0, s2: 0, s3: 0, ambiguous: 0, unmatched: 0 };
  const results: ResultRow[] = [];

  for (const row of rows) {
    const normName      = normalizeHospitalName(row.hospitalName);
    const parsedExcel   = parseAddress(row.address);
    const excelDong     = extractDong(row.address);
    const excelAddrNorm = normalizeAddressStr(row.address);

    // Stage 1
    let candidates = stage1Match(row.hospitalName, normName, parsedExcel, roadIndex);

    // Stage 2 (Stage 1 실패 시)
    if (candidates.length === 0) {
      candidates = stage2Match(row.hospitalName, normName, parsedExcel, excelDong, dongIndex);
    }

    // Stage 3 (Stage 2도 실패 시)
    if (candidates.length === 0) {
      candidates = stage3Match(row.hospitalName, normName, excelAddrNorm, parsedExcel, sigunguIndex);
    }

    const { status, matched, reason } = resolveMatch(candidates);

    if (status === 'matched') {
      if (matched!.stage === 1) stageStats.s1++;
      else if (matched!.stage === 2) stageStats.s2++;
      else stageStats.s3++;
    } else if (status === 'ambiguous') {
      stageStats.ambiguous++;
    } else {
      stageStats.unmatched++;
    }

    if (VERBOSE && matched) {
      log.debug(`[${row.hospitalName}] → [${matched.hospital.name}] stage=${matched.stage} addr=${matched.addrScore.toFixed(2)} name=${matched.nameSim.toFixed(2)}`);
    }

    const statusLabel = status === 'matched' ? '주소매칭' : status === 'ambiguous' ? '모호' : '미매칭';
    results.push({
      rowIndex:          row.rowIndex,
      '병원명(엑셀)':   row.hospitalName,
      원장명:           row.directorName,
      이메일:           row.directorEmail,
      세금계산서이메일: row.taxEmail,
      전화번호:         row.phone,
      주소:             row.address,
      이전상태:         row.originalStatus,
      매칭상태:         statusLabel,
      매칭단계:         matched ? `Stage${matched.stage}` : '',
      주소점수:         matched ? matched.addrScore.toFixed(3) : '',
      이름유사도:       matched ? matched.nameSim.toFixed(3) : '',
      복합점수:         matched ? matched.comboScore.toFixed(3) : '',
      DB병원ID:         matched?.hospital.id ?? '',
      DB병원명:         matched?.hospital.name ?? '',
      DB주소:           matched?.hospital.address ?? '',
      DB시도:           matched?.hospital.sido ?? '',
      DB시군구:         matched?.hospital.sigungu ?? '',
      DB동:             matched?.hospital.dong ?? '',
      DB이메일:         matched?.hospital.email ?? '',
      미매칭사유:       reason,
    });
  }

  const matched = stageStats.s1 + stageStats.s2 + stageStats.s3;
  log.info('─'.repeat(55));
  log.info(`매칭 합계:    ${matched}건`);
  log.info(`  Stage1 (도로명+번지):      ${stageStats.s1}건`);
  log.info(`  Stage2 (동+이름유사도):    ${stageStats.s2}건`);
  log.info(`  Stage3 (시군구+전체유사도): ${stageStats.s3}건`);
  log.info(`모호:         ${stageStats.ambiguous}건`);
  log.info(`미매칭:       ${stageStats.unmatched}건`);
  log.info('─'.repeat(55));

  // Excel 출력
  const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const outFile = path.join(outputDir, `match-by-address-${ts}.xlsx`);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results), '전체결과');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.filter(r => r.매칭상태 === '주소매칭')), '매칭');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.filter(r => r.매칭상태 === '모호')), '모호');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(results.filter(r => r.매칭상태 === '미매칭')), '미매칭');
  XLSX.writeFile(wb, outFile);
  log.info(`결과 저장: ${outFile}`);
}

main().catch(err => { log.error(err); process.exit(1); });
