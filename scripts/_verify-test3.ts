import { supabase } from './utils/supabase.js';

interface VerifyResult {
  name: string;
  hospitalId: string;
  doctors: number;
  treatments: number;
  equipments: number;
  events: number;
  sampleDoctors: string[];
  sampleTreatments: string[];
  sampleEvents: string[];
}

async function main(): Promise<void> {
  const targets = [
    { name: '안산엔비의원', hid: '1267b395-1132-4511-a8ba-1afc228a8867' },
    { name: '동안중심의원', hid: '7b169807-6d76-4796-a31b-7b35f0437899' },
    { name: '포에버의원(신사)', hid: '92f7b52a-66e9-4b1c-a118-6058f89db92e' },
  ];

  for (const t of targets) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`  ${t.name}`);
    console.log('═'.repeat(50));

    const { data: doctors } = await supabase
      .from('hospital_doctors')
      .select('name, title, specialty, career, education, academic_activity')
      .eq('hospital_id', t.hid);

    const { data: treatments } = await supabase
      .from('hospital_treatments')
      .select('treatment_name, treatment_category, price, price_note, combo_with, is_promoted')
      .eq('hospital_id', t.hid);

    const { data: equipments } = await supabase
      .from('hospital_equipments')
      .select('equipment_name, equipment_brand, equipment_category')
      .eq('hospital_id', t.hid);

    const { data: events } = await supabase
      .from('hospital_events')
      .select('title, discount_type, discount_value, related_treatments')
      .eq('hospital_id', t.hid);

    console.log(`  의사: ${doctors?.length || 0}명`);
    console.log(`  시술: ${treatments?.length || 0}개`);
    console.log(`  장비: ${equipments?.length || 0}개`);
    console.log(`  이벤트: ${events?.length || 0}개`);

    if (doctors && doctors.length > 0) {
      console.log('\n  [의사 샘플 (최대 5명)]');
      for (const d of doctors.slice(0, 5)) {
        console.log(`    - ${d.name} (${d.title}) | 전공: ${d.specialty || '-'}`);
        if (d.career?.length) console.log(`      경력: ${(d.career as string[]).slice(0, 3).join(', ')}${(d.career as string[]).length > 3 ? '...' : ''}`);
        if (d.education?.length) console.log(`      학력: ${(d.education as string[]).join(', ')}`);
        if (d.academic_activity) console.log(`      학술: ${d.academic_activity.substring(0, 60)}`);
      }
    }

    if (treatments && treatments.length > 0) {
      console.log('\n  [시술 샘플 (최대 5개)]');
      for (const tr of treatments.slice(0, 5)) {
        const price = tr.price ? `₩${tr.price.toLocaleString()}` : '-';
        const note = tr.price_note ? ` (${tr.price_note})` : '';
        const combo = tr.combo_with ? ` [콤보: ${tr.combo_with}]` : '';
        const promo = tr.is_promoted ? ' ⭐' : '';
        console.log(`    - ${tr.treatment_name} | ${tr.treatment_category} | ${price}${note}${combo}${promo}`);
      }
    }

    if (events && events.length > 0) {
      console.log('\n  [이벤트 샘플 (최대 5개)]');
      for (const ev of events.slice(0, 5)) {
        const disc = ev.discount_value ? `${ev.discount_type}: ${ev.discount_value}` : '-';
        const related = ev.related_treatments?.length ? ev.related_treatments.join(', ') : '-';
        console.log(`    - ${ev.title} | ${disc} | 관련: ${related}`);
      }
    }
  }
}

main().catch(console.error);
