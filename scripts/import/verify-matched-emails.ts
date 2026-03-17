/**
 * 매칭 이메일 검증 — Kakao → HIRA → Naver 3단계 순차 검증
 *
 * 실행:
 *   npx tsx scripts/import/verify-matched-emails.ts              # dry-run (MEDIUM만)
 *   npx tsx scripts/import/verify-matched-emails.ts --execute    # DB 업데이트
 *   npx tsx scripts/import/verify-matched-emails.ts --confidence ALL  # HIGH 포함
 *   npx tsx scripts/import/verify-matched-emails.ts --export-suspicious  # 의심건 Excel
 *   npx tsx scripts/import/verify-matched-emails.ts --limit 50   # 건수 제한 (테스트용)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx') as typeof import('xlsx');

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';
import { normalizeHospitalName } from './lib/normalizer.js';
import { searchKakaoPlaces, type KakaoPlace } from './lib/kakao-place-search.js';
import { searchHiraHospitals, type HiraHospital } from './lib/hira-hospital-search.js';
import { searchNaverLocal, type NaverPlace } from './lib/naver-local-search.js';
import {
  scoreVerification,
  normalizePhone,
  type VerificationStatus,
  type VerificationCandidate,
} from './lib/verification-scorer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('verify-matched-emails');

// ─── 설정 ─────────────────────────────────────────────
const EXECUTE    = process.argv.includes('--execute');
const EXPORT_SUS = process.argv.includes('--export-suspicious');
const CONF_MODE  = (() => { const i = process.argv.indexOf('--confidence'); return i >= 0 ? process.argv[i+1] : 'MEDIUM'; })();
const LIMIT      = (() => { const i = process.argv.indexOf('--limit'); return i >= 0 ? parseInt(process.argv[i+1]) : Infinity; })();
const DELAY_MS   = 200; // API rate limit 간격

// ─── 타입 ──────────────────────────────────────────────
interface EmailRecord {
  id: string;
  hospital_id: string;
  email: string;
  confidence: string;
  verification_status: string;
  hospital: {
    name: string;
    phone: string | null;
    address: string | null;
    sido: string | null;
    sigungu: string | null;
  };
}

interface VerifiedRecord {
  id: string;
  hospitalName: string;
  email: string;
  status: VerificationStatus;
  method: string;
  phoneMatch: boolean;
  addrMatch: boolean;
  nameSim: number;
}

// ─── 지연 ─────────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── DB 로드 ───────────────────────────────────────────
async function loadEmailRecords(confidence: string): Promise<EmailRecord[]> {
  log.info(`로딩: confidence=${confidence}`);
  const PAGE_SIZE = 200;
  const all: EmailRecord[] = [];
  let page = 0;

  while (all.length < LIMIT) {
    let query = supabase
      .from('hospital_emails')
      .select(`
        id, hospital_id, email, confidence, verification_status,
        hospital:hospitals!hospital_id(name, phone, address, sido, sigungu)
      `)
      .eq('status', 'active')
      .eq('verification_status', 'pending')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (confidence !== 'ALL') {
      query = query.eq('confidence', confidence);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const r of data) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      all.push(r as any);
    }
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  const result = all.slice(0, LIMIT);
  log.info(`검증 대상: ${result.length}건`);
  return result;
}

// ─── Stage A: Kakao ────────────────────────────────────
async function verifyByKakao(
  hospital: EmailRecord['hospital'],
): Promise<{ status: VerificationStatus; method: string; phoneMatch: boolean; addrMatch: boolean; nameSim: number; detail: Record<string, unknown> } | null> {
  const query = `${hospital.name} ${hospital.sigungu ?? ''}`.trim();
  try {
    const places = await searchKakaoPlaces(query, { size: 5 });
    if (places.length === 0) return null;

    const candidates: VerificationCandidate[] = places.map((p: KakaoPlace) => ({
      name:    p.place_name,
      address: p.road_address_name || p.address_name,
      phone:   p.phone,
    }));

    return scoreVerification(
      { name: hospital.name, phone: hospital.phone, address: hospital.address },
      candidates,
      'kakao',
    );
  } catch {
    return null;
  }
}

// ─── Stage B: HIRA ─────────────────────────────────────
async function verifyByHira(
  hospital: EmailRecord['hospital'],
): Promise<{ status: VerificationStatus; method: string; phoneMatch: boolean; addrMatch: boolean; nameSim: number; detail: Record<string, unknown> } | null> {
  // 병원명에서 핵심 키워드 추출 (의원/피부과 등 제거)
  const coreName = normalizeHospitalName(hospital.name);
  try {
    const items = await searchHiraHospitals({
      name: coreName,
      sido: hospital.sido ?? undefined,
    });
    if (items.length === 0) return null;

    const candidates: VerificationCandidate[] = items.map((h: HiraHospital) => ({
      name:    h.yadmNm,
      address: h.addr,
      phone:   h.telno,
    }));

    return scoreVerification(
      { name: hospital.name, phone: hospital.phone, address: hospital.address },
      candidates,
      'hira',
    );
  } catch {
    return null;
  }
}

// ─── Stage C: Naver ────────────────────────────────────
async function verifyByNaver(
  hospital: EmailRecord['hospital'],
): Promise<{ status: VerificationStatus; method: string; phoneMatch: boolean; addrMatch: boolean; nameSim: number; detail: Record<string, unknown> } | null> {
  const query = `${hospital.name} ${hospital.sigungu ?? ''}`.trim();
  try {
    const items = await searchNaverLocal(query, 5);
    if (items.length === 0) return null;

    const candidates: VerificationCandidate[] = items.map((p: NaverPlace) => ({
      name:    p.title,
      address: p.roadAddress || p.address,
      phone:   p.telephone,
    }));

    return scoreVerification(
      { name: hospital.name, phone: hospital.phone, address: hospital.address },
      candidates,
      'naver',
    );
  } catch {
    return null;
  }
}

// ─── DB 업데이트 ───────────────────────────────────────
async function updateVerification(
  id: string,
  status: VerificationStatus,
  method: string,
  detail: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from('hospital_emails')
    .update({
      verification_status: status,
      verification_method: method,
      verification_detail: detail,
      verified_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (error) log.error(`업데이트 오류 [${id}]: ${error.message}`);
}

// ─── 메인 ─────────────────────────────────────────────
async function main(): Promise<void> {
  log.info(`[${EXECUTE ? '실제 저장' : 'DRY-RUN'}] confidence=${CONF_MODE}, limit=${LIMIT === Infinity ? '전체' : LIMIT}`);

  const records = await loadEmailRecords(CONF_MODE);
  if (records.length === 0) { log.warn('검증 대상 없음.'); return; }

  const stats = { verified: 0, partial: 0, needs_review: 0, suspicious: 0, error: 0 };
  const suspicious: VerifiedRecord[] = [];
  const verified: VerifiedRecord[] = [];

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const hospital = Array.isArray(rec.hospital) ? rec.hospital[0] : rec.hospital;
    if (!hospital) { stats.error++; continue; }

    if (i > 0 && i % 50 === 0) {
      log.info(`  진행: ${i}/${records.length} | verified=${stats.verified} partial=${stats.partial} suspicious=${stats.suspicious}`);
    }

    // Stage A: Kakao
    await delay(DELAY_MS);
    let result = await verifyByKakao(hospital);

    // Stage B: HIRA (Kakao 미검증 시)
    if (!result || result.status === 'needs_review') {
      await delay(DELAY_MS);
      const hiraResult = await verifyByHira(hospital);
      if (hiraResult && (
        !result ||
        ({ verified: 4, partial: 3, needs_review: 2, suspicious: 1 })[hiraResult.status] >
        ({ verified: 4, partial: 3, needs_review: 2, suspicious: 1 })[result.status]
      )) {
        result = hiraResult;
      }
    }

    // Stage C: Naver (여전히 미검증 시)
    if (!result || result.status === 'needs_review') {
      await delay(DELAY_MS);
      const naverResult = await verifyByNaver(hospital);
      if (naverResult && (
        !result ||
        ({ verified: 4, partial: 3, needs_review: 2, suspicious: 1 })[naverResult.status] >
        ({ verified: 4, partial: 3, needs_review: 2, suspicious: 1 })[result.status]
      )) {
        result = naverResult;
      }
    }

    const finalStatus: VerificationStatus = result?.status ?? 'needs_review';
    const finalMethod  = result?.method ?? 'none';
    const finalDetail  = result?.detail ?? {};

    stats[finalStatus]++;

    const verRec: VerifiedRecord = {
      id: rec.id,
      hospitalName: hospital.name,
      email: rec.email,
      status: finalStatus,
      method: finalMethod,
      phoneMatch: result?.phoneMatch ?? false,
      addrMatch: result?.addrMatch ?? false,
      nameSim: result?.nameSim ?? 0,
    };

    if (finalStatus === 'suspicious') suspicious.push(verRec);
    if (finalStatus === 'verified')   verified.push(verRec);

    if (EXECUTE) {
      await updateVerification(rec.id, finalStatus, finalMethod, finalDetail);
    }
  }

  log.info('─'.repeat(55));
  log.info(`verified:      ${stats.verified}건`);
  log.info(`partial:       ${stats.partial}건`);
  log.info(`needs_review:  ${stats.needs_review}건`);
  log.info(`suspicious:    ${stats.suspicious}건`);
  if (!EXECUTE) log.info('(DRY-RUN: DB 미업데이트)');
  log.info('─'.repeat(55));

  // 의심 케이스 Excel 출력
  if (EXPORT_SUS && suspicious.length > 0) {
    const outputDir = path.resolve(__dirname, '../../output');
    const ts = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const outFile = path.join(outputDir, `suspicious-emails-${ts}.xlsx`);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(suspicious.map(r => ({
        '병원명': r.hospitalName,
        '이메일': r.email,
        '검증상태': r.status,
        '검증방법': r.method,
        '전화일치': r.phoneMatch,
        '주소일치': r.addrMatch,
        '이름유사도': r.nameSim.toFixed(3),
      }))),
      '의심건'
    );
    XLSX.writeFile(wb, outFile);
    log.info(`의심건 Excel 저장: ${outFile}`);
  }

  log.info('완료.');
}

main().catch(err => { log.error(err); process.exit(1); });
