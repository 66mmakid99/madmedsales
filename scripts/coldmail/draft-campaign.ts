/**
 * 캠페인 AI 초안 생성
 *
 * pending 상태의 campaign_emails에 Claude API로 맞춤 이메일 초안을 생성합니다.
 *
 * 실행:
 *   npx tsx scripts/coldmail/draft-campaign.ts \
 *     --campaign-id <uuid> \
 *     --template email-intro-torr-rf \
 *     [--limit 10]      # 부분 생성 (테스트용)
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const log = createLogger('draft-campaign');

function getArg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const CAMPAIGN_ID  = getArg('--campaign-id');
const TEMPLATE_NAME = getArg('--template') ?? 'email-intro-torr-rf';
const LIMIT        = getArg('--limit') ? parseInt(getArg('--limit')!, 10) : Infinity;
const DELAY_MS     = 300;

if (!CAMPAIGN_ID) throw new Error('--campaign-id 필수');

// ─── 타입 ─────────────────────────────────────────────
interface CampaignEmailRow {
  id: string;
  to_email: string;
  hospital_name: string;
  hospital_sido: string | null;
  hospital_sigungu: string | null;
  director_name: string | null;
}

interface DraftResult {
  subject: string;
  body_html: string;
  body_text: string;
}

// ─── 딜레이 ───────────────────────────────────────────
function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── 템플릿 동적 로드 ──────────────────────────────────
async function loadTemplate(name: string) {
  const mod = await import(`./templates/${name}.ts`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return mod.template as {
    buildPrompt: (ctx: Record<string, unknown>) => string;
    wrapHtml: (body: string, unsubLink: string) => string;
    model: string;
  };
}

// ─── 캠페인 + 제품 정보 로드 ───────────────────────────
async function loadCampaignInfo(id: string) {
  const { data: campaign, error } = await supabase
    .from('sales_email_campaigns')
    .select('id, name, product_id, status')
    .eq('id', id)
    .single();

  if (error || !campaign) throw new Error(`캠페인 없음: ${id}`);

  let product: Record<string, unknown> | null = null;
  if (campaign.product_id) {
    const { data } = await supabase
      .from('sales_products')
      .select('name, code, email_guide')
      .eq('id', campaign.product_id)
      .single();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    product = data as any;
  }

  return { campaign, product };
}

// ─── AI 초안 생성 ─────────────────────────────────────
async function generateDraft(
  model: string,
  prompt: string,
): Promise<DraftResult | null> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    });

    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    const response = await res.json() as { content: Array<{ type: string; text: string }> };

    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    // JSON 추출 (Claude가 마크다운 코드블록으로 감쌀 수 있음)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('JSON 파싱 실패');

    const parsed = JSON.parse(jsonMatch[0]) as DraftResult;
    if (!parsed.subject || !parsed.body_html) throw new Error('subject 또는 body_html 누락');
    return parsed;
  } catch (err) {
    log.warn(`AI 초안 생성 실패: ${String(err)}`);
    return null;
  }
}

// ─── 메인 ─────────────────────────────────────────────
async function main(): Promise<void> {
  log.info(`캠페인 ID: ${CAMPAIGN_ID}, 템플릿: ${TEMPLATE_NAME}`);

  const [tmpl, { campaign, product }] = await Promise.all([
    loadTemplate(TEMPLATE_NAME),
    loadCampaignInfo(CAMPAIGN_ID!),
  ]);

  log.info(`캠페인: ${campaign.name} (status: ${campaign.status})`);
  log.info(`제품: ${product ? (product.name as string) : '없음'}, 모델: ${tmpl.model}`);

  // pending + body_html IS NULL 인 레코드 로드
  const { data: emails, error } = await supabase
    .from('sales_campaign_emails')
    .select('id, to_email, hospital_name, hospital_sido, hospital_sigungu, director_name')
    .eq('campaign_id', CAMPAIGN_ID!)
    .eq('status', 'pending')
    .is('body_html', null)
    .limit(LIMIT === Infinity ? 10000 : LIMIT);

  if (error) throw new Error(`조회 오류: ${error.message}`);
  if (!emails || emails.length === 0) {
    log.info('초안 생성 대상 없음 (이미 완료되었거나 pending 없음)');
    return;
  }

  log.info(`초안 생성 대상: ${emails.length}건`);

  const stats = { success: 0, failed: 0 };

  for (let i = 0; i < emails.length; i++) {
    const row = emails[i] as CampaignEmailRow;

    if (i > 0 && i % 20 === 0) {
      log.info(`  진행: ${i}/${emails.length} | 성공=${stats.success} 실패=${stats.failed}`);
    }

    const prompt = tmpl.buildPrompt({
      hospitalName: row.hospital_name,
      sido: row.hospital_sido,
      sigungu: row.hospital_sigungu,
      directorName: row.director_name,
      productName: (product?.name as string) ?? TEMPLATE_NAME,
      productEmailGuide: (product?.email_guide as Record<string, unknown>) ?? {},
    });

    await delay(DELAY_MS);
    const draft = await generateDraft(tmpl.model, prompt);

    if (!draft) {
      // 초안 실패 → admin_note에 기록, body_html은 NULL 유지
      await supabase
        .from('sales_campaign_emails')
        .update({ admin_note: 'draft_failed', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      stats.failed++;
      continue;
    }

    // 수신거부 링크용 unsubscribe URL
    const unsubLink = `${process.env.WEB_URL ?? 'https://madmedsales.com'}/unsubscribe?id=${row.id}`;
    const bodyHtmlWrapped = tmpl.wrapHtml(draft.body_html, unsubLink);

    await supabase
      .from('sales_campaign_emails')
      .update({
        subject: draft.subject,
        body_html: bodyHtmlWrapped,
        body_text: draft.body_text,
        ai_prompt_used: prompt,
        admin_note: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);

    stats.success++;
  }

  // 캠페인 상태 업데이트
  await supabase
    .from('sales_email_campaigns')
    .update({
      draft_count: stats.success,
      status: stats.success > 0 ? 'reviewing' : 'draft',
      updated_at: new Date().toISOString(),
    })
    .eq('id', CAMPAIGN_ID!);

  log.info('─'.repeat(55));
  log.info(`초안 생성 완료: 성공=${stats.success}, 실패=${stats.failed}`);
  log.info(`캠페인 status → 'reviewing'`);
  log.info('─'.repeat(55));
  log.info(`다음 단계: Admin UI에서 검토/승인`);
  log.info(`  http://localhost:3001/coldmail/${CAMPAIGN_ID}`);
}

main().catch(err => { log.error(String(err)); process.exit(1); });
