/**
 * Insight Cards 익명화
 * clinic_name, doctor_name을 코드로 대체
 * raw_text에서도 병원명/원장명 제거
 *
 * 실행: npx tsx scripts/hira/anonymize-insight-cards.ts
 */
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('anonymize');

async function main(): Promise<void> {
  const { data: cards, error } = await supabase
    .from('sales_insight_cards')
    .select('id, source_id, raw_text, structured')
    .eq('source_channel', 'youtube');

  if (error || !cards) {
    log.error(`Query failed: ${error?.message}`);
    return;
  }

  log.info(`=== Anonymizing ${cards.length} insight cards ===`);

  let updated = 0;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const structured = card.structured as Record<string, unknown>;
    const clinicName = structured.clinic_name as string;
    const doctorName = structured.doctor_name as string;
    const code = `YT-${String(i + 1).padStart(2, '0')}`;

    // structured 익명화
    const newStructured = { ...structured };
    newStructured.clinic_name = code;
    newStructured.doctor_name = code;
    newStructured.source_code = code;

    // raw_text 익명화
    let rawText = card.raw_text as string;
    if (clinicName && clinicName !== '미상') {
      rawText = rawText.replaceAll(clinicName, code);
    }
    if (doctorName && doctorName !== '미상') {
      rawText = rawText.replaceAll(doctorName, code);
    }
    // "원장" 앞 이름 패턴도 제거
    rawText = rawText.replace(/\[.*?\]\s*/, `[${code}] `);

    const { error: updateErr } = await supabase
      .from('sales_insight_cards')
      .update({
        structured: newStructured,
        raw_text: rawText,
      })
      .eq('id', card.id);

    if (updateErr) {
      log.error(`Update failed for ${card.id}: ${updateErr.message}`);
    } else {
      updated++;
      log.info(`✓ ${clinicName} (${doctorName}) → ${code}`);
    }
  }

  log.info('');
  log.info(`=== Anonymization complete: ${updated}/${cards.length} ===`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
