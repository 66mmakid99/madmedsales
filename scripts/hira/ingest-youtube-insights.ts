/**
 * Step 3-B: 유튜브 인터뷰 데이터 → sales_insight_cards 인제스트
 * ⚠️ 병원명/원장명은 절대 DB에 저장하지 않음 — 익명 코드(YT-01~)로 매핑
 * 원본 매핑은 로컬 JSON 파일에만 보존
 *
 * 실행: npx tsx scripts/hira/ingest-youtube-insights.ts
 */
import fs from 'fs/promises';
import path from 'path';
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('ingest-youtube');

interface VideoData {
  video_id: string;
  url: string;
  clinic_info: {
    clinic_name: string;
    doctor_name: string;
  };
  product_name: string;
  advantages: string[];
  clinical_applications: string[];
  madmedsales_scoring_criteria?: ScoringCriteria;
  torr_rf_scoring_criteria?: ScoringCriteria;
}

interface ScoringCriteria {
  high_probability_keywords: string[];
  combine_therapy_potential: string[];
  target_equipment_stack: Array<{
    equipment: string;
    pitching_strategy: string;
  }>;
  clinic_expansion_status: string;
}

async function getProductId(productName: string): Promise<string | null> {
  const { data } = await supabase
    .from('sales_products')
    .select('id')
    .ilike('name', `%${productName}%`)
    .limit(1);

  return data?.[0]?.id ?? null;
}

async function main(): Promise<void> {
  const dataPath = path.resolve('C:/Users/J/madmedsales_scoring_data.json');
  const raw = await fs.readFile(dataPath, 'utf-8');
  const videos: VideoData[] = JSON.parse(raw);

  log.info(`=== Ingesting ${videos.length} YouTube interview insights (anonymized) ===`);

  const productId = await getProductId('TORR');
  if (!productId) {
    log.warn('TORR RF product not found in DB. Inserting without product_id.');
  } else {
    log.info(`Found TORR RF product: ${productId}`);
  }

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < videos.length; i++) {
    const video = videos[i];
    const code = `YT-${String(i + 1).padStart(2, '0')}`;
    const criteria = video.madmedsales_scoring_criteria ?? video.torr_rf_scoring_criteria;

    if (!criteria) {
      log.warn(`No scoring criteria for ${code}, skipping`);
      skipped++;
      continue;
    }

    // 중복 체크 (source_id 기준)
    const { data: existing } = await supabase
      .from('sales_insight_cards')
      .select('id')
      .eq('source_id', video.video_id)
      .limit(1);

    if (existing && existing.length > 0) {
      log.info(`Already exists: ${code}`);
      skipped++;
      continue;
    }

    // ⚠️ 익명화된 structured — 병원명/원장명 절대 포함 금지
    const structured = {
      source_code: code,
      advantages: video.advantages,
      clinical_applications: video.clinical_applications,
      target_equipment_stack: criteria.target_equipment_stack,
      combine_therapy_potential: criteria.combine_therapy_potential,
      clinic_expansion_status: criteria.clinic_expansion_status,
      objection: criteria.target_equipment_stack[0]?.pitching_strategy ?? null,
      trigger: criteria.clinic_expansion_status,
      angle: video.advantages[0] ?? null,
      persona_hint: criteria.clinic_expansion_status,
      confidence: 0.85,
    };

    // 태그 = 키워드 + 장비명 + 복합시술 (개인정보 없음)
    const tags = [
      ...criteria.high_probability_keywords,
      ...criteria.target_equipment_stack.map((t) => t.equipment),
      ...criteria.combine_therapy_potential,
    ];

    // ⚠️ 익명화된 raw_text — 병원명/원장명 제거
    const rawText = [
      `[${code}] 기고객 인터뷰`,
      '',
      '== 장점 ==',
      ...video.advantages.map((a, idx) => `${idx + 1}. ${a}`),
      '',
      '== 임상 적용 ==',
      ...video.clinical_applications.map((a, idx) => `${idx + 1}. ${a}`),
      '',
      '== 타겟 병원 유형 ==',
      criteria.clinic_expansion_status,
      '',
      '== 피칭 전략 ==',
      ...criteria.target_equipment_stack.map((t) => `${t.equipment}: ${t.pitching_strategy}`),
    ].join('\n');

    const { error } = await supabase
      .from('sales_insight_cards')
      .insert({
        source_channel: 'youtube',
        source_id: video.video_id,
        raw_text: rawText,
        structured,
        tags,
        product_id: productId,
      });

    if (error) {
      log.error(`Insert failed for ${code}: ${error.message}`);
    } else {
      inserted++;
      log.info(`✓ ${code} — ${tags.length} tags`);
    }
  }

  log.info('');
  log.info('=== Ingest complete ===');
  log.info(`Inserted: ${inserted}`);
  log.info(`Skipped: ${skipped}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
