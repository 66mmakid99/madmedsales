/**
 * 콜드메일 캠페인 생성
 *
 * hospital_emails(verified/partial)에서 조건 필터링 후
 * sales_email_campaigns + sales_campaign_emails(pending) 레코드 생성
 *
 * 실행:
 *   npx tsx scripts/coldmail/create-campaign.ts \
 *     --name "TORR RF 1차 - 서울 피부과" \
 *     --purpose "TORR RF 장비 인트로 콜드메일" \
 *     [--sido 서울] [--confidence HIGH] [--email-type director] [--limit 100]
 *
 *   --execute 없으면 dry-run (기본)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('create-campaign');

// ─── CLI 인수 파싱 ─────────────────────────────────────
function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function hasFlag(flag: string): boolean { return process.argv.includes(flag); }

const EXECUTE      = hasFlag('--execute');
const NAME         = getArg('--name');
const PURPOSE      = getArg('--purpose');
const SIDO         = getArg('--sido');
const CONFIDENCE   = getArg('--confidence');  // HIGH | MEDIUM | ALL
const EMAIL_TYPE   = getArg('--email-type');  // director | tax_invoice | ALL
const LIMIT        = getArg('--limit') ? parseInt(getArg('--limit')!, 10) : Infinity;
const PRODUCT_CODE = getArg('--product-code');
const DAILY_LIMIT  = getArg('--daily-limit') ? parseInt(getArg('--daily-limit')!, 10) : 50;

// ─── 타입 ─────────────────────────────────────────────
interface HospitalEmail {
  id: string;
  hospital_id: string;
  email: string;
  email_type: string;
  confidence: string;
  verification_status: string;
  director_name: string | null;
  hospital: {
    name: string;
    sido: string | null;
    sigungu: string | null;
  };
}

// ─── 유효성 검사 ───────────────────────────────────────
function validate(): void {
  if (!NAME) throw new Error('--name 필수: 캠페인 이름을 지정하세요.');
  if (!PURPOSE) throw new Error('--purpose 필수: 캠페인 목적을 지정하세요.');
}

// ─── 90일 내 발송 이력 이메일 조회 ────────────────────
async function getRecentlySentEmails(): Promise<Set<string>> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('sales_campaign_emails')
    .select('to_email')
    .eq('status', 'sent')
    .gte('sent_at', since);

  if (error) {
    log.warn(`최근 발송 이력 조회 오류: ${error.message}`);
    return new Set();
  }
  return new Set((data ?? []).map(r => r.to_email.toLowerCase()));
}

// ─── 수신거부 이메일 조회 ──────────────────────────────
async function getUnsubscribedEmails(): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('sales_unsubscribes')
    .select('email');

  if (error) {
    log.warn(`수신거부 조회 오류: ${error.message}`);
    return new Set();
  }
  return new Set((data ?? []).map(r => r.email.toLowerCase()));
}

// ─── 제품 조회 ────────────────────────────────────────
async function getProductId(code: string): Promise<string | null> {
  const { data } = await supabase
    .from('sales_products')
    .select('id')
    .eq('code', code)
    .single();
  return data?.id ?? null;
}

// ─── 메인 ─────────────────────────────────────────────
async function main(): Promise<void> {
  validate();

  log.info(`[${EXECUTE ? '실제 저장' : 'DRY-RUN'}] 캠페인 생성 시작`);
  log.info(`  이름: ${NAME}`);
  log.info(`  목적: ${PURPOSE}`);
  log.info(`  필터: sido=${SIDO ?? '전체'}, confidence=${CONFIDENCE ?? '전체'}, email_type=${EMAIL_TYPE ?? '전체'}`);

  // 제품 ID 조회
  let productId: string | null = null;
  if (PRODUCT_CODE) {
    productId = await getProductId(PRODUCT_CODE);
    if (!productId) log.warn(`제품 코드 '${PRODUCT_CODE}' 없음 — product_id=null로 진행`);
  }

  // hospital_emails 쿼리
  let query = supabase
    .from('hospital_emails')
    .select(`
      id, hospital_id, email, email_type, confidence, verification_status, director_name,
      hospital:hospitals!hospital_id(name, sido, sigungu)
    `)
    .eq('status', 'active')
    .in('verification_status', ['verified', 'partial']);

  if (CONFIDENCE && CONFIDENCE !== 'ALL') {
    query = query.eq('confidence', CONFIDENCE);
  }
  if (EMAIL_TYPE && EMAIL_TYPE !== 'ALL') {
    query = query.eq('email_type', EMAIL_TYPE);
  }

  // 페이지네이션으로 전체 로드
  const PAGE = 200;
  const allEmails: HospitalEmail[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await query.range(page * PAGE, (page + 1) * PAGE - 1);
    if (error) throw new Error(`hospital_emails 조회 오류: ${error.message}`);
    if (!data || data.length === 0) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of data) allEmails.push(r as any);
    if (data.length < PAGE) break;
    page++;
  }

  // 지역 필터 (sido 기준 메모리 필터)
  let filtered = allEmails;
  if (SIDO) {
    filtered = filtered.filter(r => {
      const hosp = Array.isArray(r.hospital) ? r.hospital[0] : r.hospital;
      return hosp?.sido?.includes(SIDO!);
    });
  }

  log.info(`  hospital_emails 원본: ${allEmails.length}건 → 지역필터 후: ${filtered.length}건`);

  // 수신거부 & 90일 중복 제거
  const [unsubSet, recentSet] = await Promise.all([
    getUnsubscribedEmails(),
    getRecentlySentEmails(),
  ]);

  const beforeFilter = filtered.length;
  filtered = filtered.filter(r => {
    const email = r.email.toLowerCase();
    return !unsubSet.has(email) && !recentSet.has(email);
  });

  const removed = beforeFilter - filtered.length;
  if (removed > 0) log.info(`  수신거부/90일 중복 ${removed}건 제거`);

  // LIMIT 적용
  if (filtered.length > LIMIT) filtered = filtered.slice(0, LIMIT);

  log.info(`  최종 대상: ${filtered.length}건`);

  if (filtered.length === 0) {
    log.warn('대상 이메일이 없습니다. 필터 조건을 확인하세요.');
    return;
  }

  // DRY-RUN 출력
  if (!EXECUTE) {
    log.info('=== 샘플 (상위 5건) ===');
    filtered.slice(0, 5).forEach((r, i) => {
      const hosp = Array.isArray(r.hospital) ? r.hospital[0] : r.hospital;
      log.info(`  ${i + 1}. ${hosp?.name ?? r.hospital_id} (${hosp?.sido} ${hosp?.sigungu}) | ${r.email} [${r.confidence}]`);
    });
    log.info(`\n💡 실제 생성: 위 명령에 --execute 추가`);
    return;
  }

  // ─── 실제 저장 ─────────────────────────────────────
  const targetFilter: Record<string, unknown> = {};
  if (SIDO) targetFilter.sido = SIDO;
  if (CONFIDENCE) targetFilter.confidence = CONFIDENCE;
  if (EMAIL_TYPE) targetFilter.email_type = EMAIL_TYPE;
  if (LIMIT !== Infinity) targetFilter.limit = LIMIT;
  if (PRODUCT_CODE) targetFilter.product_code = PRODUCT_CODE;

  // 캠페인 생성
  const { data: campaign, error: campErr } = await supabase
    .from('sales_email_campaigns')
    .insert({
      name: NAME!,
      purpose: PURPOSE!,
      product_id: productId,
      target_filter: targetFilter,
      total_count: filtered.length,
      daily_limit: DAILY_LIMIT,
      status: 'draft',
      created_by: process.env.ADMIN_EMAIL ?? 'admin',
    })
    .select('id')
    .single();

  if (campErr || !campaign) throw new Error(`캠페인 생성 오류: ${campErr?.message}`);
  log.info(`캠페인 생성 완료: ${campaign.id}`);

  // campaign_emails 일괄 삽입
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < filtered.length; i += BATCH) {
    const batch = filtered.slice(i, i + BATCH);
    const rows = batch.map(r => {
      const hosp = Array.isArray(r.hospital) ? r.hospital[0] : r.hospital;
      return {
        campaign_id: campaign.id,
        hospital_email_id: r.id,
        hospital_id: r.hospital_id,
        to_email: r.email.toLowerCase(),
        hospital_name: hosp?.name ?? '',
        hospital_sido: hosp?.sido ?? null,
        hospital_sigungu: hosp?.sigungu ?? null,
        director_name: r.director_name ?? null,
        status: 'pending',
      };
    });

    const { error } = await supabase
      .from('sales_campaign_emails')
      .insert(rows);

    if (error) {
      log.error(`배치 삽입 오류 (${i}~${i + BATCH}): ${error.message}`);
    } else {
      inserted += batch.length;
    }
  }

  log.info(`campaign_emails 생성: ${inserted}건`);
  log.info('─'.repeat(55));
  log.info(`캠페인 ID: ${campaign.id}`);
  log.info(`이름: ${NAME}`);
  log.info(`대상: ${inserted}건`);
  log.info('─'.repeat(55));
  log.info(`다음 단계:`);
  log.info(`  초안 생성: npx tsx scripts/coldmail/draft-campaign.ts --campaign-id ${campaign.id} --template email-intro-torr-rf`);
  log.info(`  Admin UI: http://localhost:3001/coldmail/${campaign.id}`);
}

main().catch(err => { log.error(String(err)); process.exit(1); });
