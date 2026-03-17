/**
 * 캠페인 검토 현황 CLI 리포트
 *
 * 실행:
 *   npx tsx scripts/coldmail/review-report.ts --campaign-id <uuid> [--sample 5]
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('review-report');

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CAMPAIGN_ID = getArg('--campaign-id');
const SAMPLE_N    = parseInt(getArg('--sample') ?? '3', 10);

if (!CAMPAIGN_ID) throw new Error('--campaign-id 필수');

function pct(n: number, total: number): string {
  if (total === 0) return '  0.0%';
  return `${((n / total) * 100).toFixed(1).padStart(5)}%`;
}

async function main(): Promise<void> {
  // 캠페인 조회
  const { data: camp, error: campErr } = await supabase
    .from('sales_email_campaigns')
    .select('*')
    .eq('id', CAMPAIGN_ID!)
    .single();

  if (campErr || !camp) throw new Error(`캠페인 없음: ${CAMPAIGN_ID}`);

  // 상태별 집계
  const { data: statusRows } = await supabase
    .from('sales_campaign_emails')
    .select('status')
    .eq('campaign_id', CAMPAIGN_ID!);

  const counts: Record<string, number> = {
    pending: 0, approved: 0, rejected: 0, sent: 0, bounced: 0, failed: 0,
  };
  for (const r of statusRows ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  // 샘플 출력 (approved 우선, 없으면 pending)
  const sampleStatus = counts.approved > 0 ? 'approved' : 'pending';
  const { data: samples } = await supabase
    .from('sales_campaign_emails')
    .select('hospital_name, hospital_sido, hospital_sigungu, to_email, subject, status')
    .eq('campaign_id', CAMPAIGN_ID!)
    .eq('status', sampleStatus)
    .limit(SAMPLE_N);

  console.log('\n' + '━'.repeat(58));
  console.log(` 캠페인: ${camp.name}`);
  console.log(` 목적: ${camp.purpose}`);
  console.log(` 상태: ${camp.status.toUpperCase()} | 총 대상: ${total}건`);
  console.log('━'.repeat(58));
  console.log(` pending:  ${String(counts.pending).padStart(4)}건 (${pct(counts.pending, total)})`);
  console.log(` approved: ${String(counts.approved).padStart(4)}건 (${pct(counts.approved, total)})`);
  console.log(` rejected: ${String(counts.rejected).padStart(4)}건 (${pct(counts.rejected, total)})`);
  console.log(` sent:     ${String(counts.sent).padStart(4)}건 (${pct(counts.sent, total)})`);
  if (counts.bounced > 0) console.log(` bounced:  ${String(counts.bounced).padStart(4)}건 (${pct(counts.bounced, total)})`);
  if (counts.failed > 0) console.log(` failed:   ${String(counts.failed).padStart(4)}건 (${pct(counts.failed, total)})`);
  console.log('━'.repeat(58));

  if (samples && samples.length > 0) {
    console.log(` [샘플 - ${sampleStatus}]`);
    samples.forEach((s, i) => {
      const region = [s.hospital_sido, s.hospital_sigungu].filter(Boolean).join(' ');
      console.log(` ${i + 1}. ${s.hospital_name} (${region}) | ${s.to_email}`);
      if (s.subject) console.log(`    제목: ${s.subject}`);
    });
  }

  console.log('━'.repeat(58));

  if (camp.status === 'reviewing' && counts.approved === 0) {
    console.log(` ⚠️  Admin UI에서 이메일을 검토/승인하세요.`);
  } else if (camp.status === 'approved') {
    console.log(` ✅ 캠페인 승인 완료. 발송 준비 완료.`);
    console.log(`    발송: npx tsx scripts/coldmail/send-campaign.ts --campaign-id ${CAMPAIGN_ID} --execute`);
  } else if (camp.status === 'completed') {
    console.log(` 🎉 발송 완료`);
  }

  const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3001';
  console.log(`\n Admin UI: ${WEB_URL}/coldmail/${CAMPAIGN_ID}`);
  console.log();
}

main().catch(err => { log.error(String(err)); process.exit(1); });
