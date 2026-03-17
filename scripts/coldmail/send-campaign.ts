/**
 * 승인된 이메일만 Resend로 발송
 *
 * 안전장치 (이중):
 *   1. campaign.status === 'approved' (관리자 캠페인 전체 승인 필수)
 *   2. campaign_email.status === 'approved' (개별 이메일 승인 필수)
 *
 * 실행:
 *   npx tsx scripts/coldmail/send-campaign.ts --campaign-id <uuid>          # dry-run
 *   npx tsx scripts/coldmail/send-campaign.ts --campaign-id <uuid> --execute # 실제 발송
 *   npx tsx scripts/coldmail/send-campaign.ts --campaign-id <uuid> --execute --batch-size 5
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('send-campaign');

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CAMPAIGN_ID  = getArg('--campaign-id');
const EXECUTE      = process.argv.includes('--execute');
const BATCH_SIZE   = parseInt(getArg('--batch-size') ?? '10', 10);
const SEND_DELAY   = 2500; // ms (2.5초 간격)

if (!CAMPAIGN_ID) throw new Error('--campaign-id 필수');

const RESEND_API_KEY  = process.env.RESEND_API_KEY ?? '';
const FROM_EMAIL      = process.env.COLDMAIL_FROM ?? 'MADMEDSALES <sales@madmedsales.com>';
const UNSUBSCRIBE_BASE = `${process.env.WEB_URL ?? 'https://madmedsales.com'}/unsubscribe`;

// ─── 타입 ─────────────────────────────────────────────
interface CampaignEmailRow {
  id: string;
  to_email: string;
  hospital_name: string;
  subject: string;
  body_html: string;
  body_text: string | null;
}

// ─── 딜레이 ───────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── 오늘 발송 건수 조회 ───────────────────────────────
async function getTodaySentCount(campaignId: string): Promise<number> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count } = await supabase
    .from('sales_campaign_emails')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'sent')
    .gte('sent_at', todayStart.toISOString());

  return count ?? 0;
}

// ─── 수신거부 확인 ────────────────────────────────────
async function isUnsubscribed(email: string): Promise<boolean> {
  const { data } = await supabase
    .from('sales_unsubscribes')
    .select('email')
    .eq('email', email.toLowerCase())
    .maybeSingle();
  return !!data;
}

// ─── Resend 발송 ─────────────────────────────────────
async function sendViaResend(row: CampaignEmailRow): Promise<string | null> {
  const unsubLink = `${UNSUBSCRIBE_BASE}?id=${row.id}`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [row.to_email],
        subject: row.subject,
        html: row.body_html,
        text: row.body_text ?? undefined,
        headers: {
          'List-Unsubscribe': `<mailto:unsubscribe@madmedsales.com?subject=${row.id}>, <${unsubLink}>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log.error(`Resend 오류 [${row.to_email}]: ${res.status} ${body}`);
      return null;
    }

    const json = await res.json() as { id?: string };
    return json.id ?? null;
  } catch (err) {
    log.error(`Resend 예외 [${row.to_email}]: ${String(err)}`);
    return null;
  }
}

// ─── 메인 ─────────────────────────────────────────────
async function main(): Promise<void> {
  log.info(`[${EXECUTE ? '실제 발송' : 'DRY-RUN'}] 캠페인: ${CAMPAIGN_ID}`);

  // 캠페인 조회
  const { data: campaign, error: campErr } = await supabase
    .from('sales_email_campaigns')
    .select('id, name, status, daily_limit, send_hour_start, send_hour_end')
    .eq('id', CAMPAIGN_ID!)
    .single();

  if (campErr || !campaign) throw new Error(`캠페인 없음: ${CAMPAIGN_ID}`);

  log.info(`캠페인: ${campaign.name} (status: ${campaign.status})`);

  // ─── 안전장치 1: 캠페인 상태 체크 ───────────────────
  if (campaign.status !== 'approved') {
    log.error(`❌ 발송 불가: campaign.status = '${campaign.status}' (필요: 'approved')`);
    log.error(`   Admin UI에서 캠페인을 승인하세요.`);
    process.exit(1);
  }

  // ─── 안전장치 2: 발송 시간대 체크 ───────────────────
  if (EXECUTE) {
    const nowKST = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const hour = nowKST.getUTCHours();
    if (hour < campaign.send_hour_start || hour >= campaign.send_hour_end) {
      log.warn(`⚠️  발송 시간 외: 현재 ${hour}시 KST (허용: ${campaign.send_hour_start}~${campaign.send_hour_end}시)`);
      log.warn(`   --force 없이는 시간 외 발송 불가`);
      process.exit(1);
    }
  }

  // ─── 일일 한도 확인 ──────────────────────────────────
  const todaySent = await getTodaySentCount(CAMPAIGN_ID!);
  const remaining = campaign.daily_limit - todaySent;
  log.info(`오늘 발송: ${todaySent}건 / 한도: ${campaign.daily_limit}건 / 잔여: ${remaining}건`);

  if (remaining <= 0) {
    log.warn(`⚠️  오늘 일일 한도 초과. 내일 다시 실행하세요.`);
    return;
  }

  // approved 이메일 조회 (BATCH_SIZE와 remaining 중 작은 값)
  const fetchLimit = Math.min(BATCH_SIZE, remaining);
  const { data: emails, error: emailErr } = await supabase
    .from('sales_campaign_emails')
    .select('id, to_email, hospital_name, subject, body_html, body_text')
    .eq('campaign_id', CAMPAIGN_ID!)
    .eq('status', 'approved')  // 안전장치 2: approved만
    .not('subject', 'is', null)
    .not('body_html', 'is', null)
    .limit(fetchLimit);

  if (emailErr) throw new Error(`이메일 조회 오류: ${emailErr.message}`);
  if (!emails || emails.length === 0) {
    log.info('발송할 approved 이메일 없음.');
    return;
  }

  log.info(`발송 대상: ${emails.length}건`);

  if (!EXECUTE) {
    log.info('=== DRY-RUN 샘플 (상위 3건) ===');
    emails.slice(0, 3).forEach((r, i) => {
      log.info(`  ${i + 1}. ${r.to_email} | ${r.subject}`);
    });
    log.info(`\n💡 실제 발송: --execute 추가`);
    return;
  }

  // ─── 실제 발송 ─────────────────────────────────────
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY 환경변수 없음');

  const stats = { sent: 0, failed: 0, skipped: 0 };

  for (let i = 0; i < emails.length; i++) {
    const row = emails[i] as CampaignEmailRow;

    // 발송 직전 수신거부 재확인
    const unsub = await isUnsubscribed(row.to_email);
    if (unsub) {
      log.warn(`  수신거부 스킵: ${row.to_email}`);
      await supabase
        .from('sales_campaign_emails')
        .update({ status: 'rejected', admin_note: 'unsubscribed', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      stats.skipped++;
      continue;
    }

    if (i > 0) await delay(SEND_DELAY);

    log.info(`  발송 [${i + 1}/${emails.length}]: ${row.to_email} | ${row.subject}`);

    const messageId = await sendViaResend(row);

    if (messageId) {
      await supabase
        .from('sales_campaign_emails')
        .update({
          status: 'sent',
          resend_message_id: messageId,
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);

      stats.sent++;
    } else {
      await supabase
        .from('sales_campaign_emails')
        .update({
          status: 'failed',
          admin_note: 'resend_error',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
      stats.failed++;
    }
  }

  // 캠페인 sent_count 업데이트
  if (stats.sent > 0) {
    const { data: camp } = await supabase
      .from('sales_email_campaigns')
      .select('sent_count')
      .eq('id', CAMPAIGN_ID!)
      .single();

    const newSentCount = (camp?.sent_count ?? 0) + stats.sent;

    // 전체 approved 0건이면 completed로
    const { count: remainApproved } = await supabase
      .from('sales_campaign_emails')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', CAMPAIGN_ID!)
      .eq('status', 'approved');

    await supabase
      .from('sales_email_campaigns')
      .update({
        sent_count: newSentCount,
        status: remainApproved === 0 ? 'completed' : 'sending',
        updated_at: new Date().toISOString(),
      })
      .eq('id', CAMPAIGN_ID!);
  }

  log.info('─'.repeat(55));
  log.info(`발송 완료: ${stats.sent}건 | 실패: ${stats.failed}건 | 수신거부 스킵: ${stats.skipped}건`);
  log.info('─'.repeat(55));

  const nextApproved = await supabase
    .from('sales_campaign_emails')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', CAMPAIGN_ID!)
    .eq('status', 'approved');

  if ((nextApproved.count ?? 0) > 0) {
    log.info(`잔여 approved: ${nextApproved.count}건 — 내일 또는 한도 잔여 시 재실행`);
  } else {
    log.info('모든 approved 이메일 발송 완료');
  }
}

main().catch(err => { log.error(String(err)); process.exit(1); });
