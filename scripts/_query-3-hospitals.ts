import { config } from 'dotenv';
config({ path: 'scripts/.env' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main(): Promise<void> {
  const hospitals = [
    { id: '1267b395-1132-4511-a8ba-1afc228a8867', name: '안산엔비의원' },
    { id: '7b169807-6d76-4796-a31b-7b35f0437899', name: '동안중심의원' },
    { id: '92f7b52a-66e9-4b1c-a118-6058f89db92e', name: '포에버의원(신사)' },
  ];

  for (const h of hospitals) {
    console.log('\n' + '='.repeat(80));
    console.log('HOSPITAL:', h.name);

    const { data: doctors } = await supabase.from('hospital_doctors')
      .select('*').eq('hospital_id', h.id);
    console.log('\n### DOCTORS (' + (doctors?.length || 0) + '):');
    doctors?.forEach((d, i) => {
      console.log(i + 1 + '.', d.name, '|', d.title, '|', d.specialty);
      if (d.career) console.log('  career:', typeof d.career === 'string' ? d.career.substring(0, 200) : JSON.stringify(d.career)?.substring(0, 200));
      if (d.education) console.log('  education:', typeof d.education === 'string' ? d.education.substring(0, 200) : JSON.stringify(d.education)?.substring(0, 200));
      if (d.academic_activity) console.log('  academic:', typeof d.academic_activity === 'string' ? d.academic_activity.substring(0, 200) : JSON.stringify(d.academic_activity)?.substring(0, 200));
      if (d.notes) console.log('  notes:', d.notes);
    });

    const { data: treatments } = await supabase.from('hospital_treatments')
      .select('*').eq('hospital_id', h.id);
    const withPrice = treatments?.filter(t => t.price !== null) || [];
    const withoutPrice = treatments?.filter(t => t.price === null) || [];
    console.log('\n### TREATMENTS: total=' + (treatments?.length || 0) + ', withPrice=' + withPrice.length + ', withoutPrice=' + withoutPrice.length);

    const catMap = new Map();
    treatments?.forEach(t => {
      const cat = t.treatment_category || 'other';
      if (!catMap.has(cat)) catMap.set(cat, []);
      catMap.get(cat).push(t);
    });
    for (const [cat, items] of catMap) {
      console.log('  [' + cat + '] ' + items.length + '개');
    }

    console.log('\n### PRICED TREATMENTS:');
    withPrice.forEach((t, i) => {
      console.log(i + 1 + '.', t.treatment_name, '|', t.price, '원 |', t.price_note || '', '| promoted:', t.is_promoted, '| combo:', t.combo_with || '-');
    });

    console.log('\n### UNPRICED TREATMENTS (first 30):');
    withoutPrice.slice(0, 30).forEach((t, i) => {
      console.log(i + 1 + '.', t.treatment_name, '(' + t.treatment_category + ')');
    });

    const { data: equipment } = await supabase.from('hospital_equipments')
      .select('*').eq('hospital_id', h.id);
    console.log('\n### EQUIPMENT (' + (equipment?.length || 0) + '):');
    equipment?.forEach((e, i) => {
      console.log(i + 1 + '.', e.equipment_name, '|', e.equipment_category, '|', e.manufacturer || '-');
    });

    const { data: events } = await supabase.from('hospital_events')
      .select('*').eq('hospital_id', h.id);
    console.log('\n### EVENTS (' + (events?.length || 0) + '):');
    events?.forEach((e, i) => {
      console.log(i + 1 + '.', e.title, '|', e.discount_type, '|', e.discount_value || '-');
      if (e.description) console.log('  desc:', e.description?.substring(0, 150));
      if (e.related_treatments?.length) console.log('  related:', e.related_treatments);
    });

    const { data: pages } = await supabase.from('hospital_crawl_pages')
      .select('page_url, page_type, content_type, char_count, screenshot_url, crawl_version')
      .eq('hospital_id', h.id);
    console.log('\n### CRAWL PAGES (' + (pages?.length || 0) + '):');
    pages?.forEach((p, i) => {
      console.log(i + 1 + '.', p.page_type, '|', p.char_count + '자 |', p.crawl_version, '|', p.page_url?.substring(0, 60));
    });

    const { data: validations } = await supabase.from('hospital_crawl_validations')
      .select('*').eq('hospital_id', h.id).order('created_at', { ascending: false });
    console.log('\n### VALIDATIONS (' + (validations?.length || 0) + '):');
    validations?.forEach((v, i) => {
      console.log(i + 1 + '.', v.result, '| equip:', v.equipment_coverage, '| treat:', v.treatment_coverage, '| doc:', v.doctor_coverage, '| overall:', v.overall_coverage);
      if (v.missing_equipments?.length) console.log('  missing_equip:', v.missing_equipments.slice(0, 10));
      if (v.missing_treatments?.length) console.log('  missing_treat:', v.missing_treatments.slice(0, 10));
      if (v.missing_doctors?.length) console.log('  missing_doc:', v.missing_doctors);
      if (v.issues?.length) console.log('  issues:', v.issues.slice(0, 5));
    });

    const { data: hosp } = await supabase.from('hospitals')
      .select('name, address, phone, website, crawled_at, sido, sigungu')
      .eq('id', h.id).single();
    console.log('\n### BASIC INFO:');
    console.log(JSON.stringify(hosp, null, 2));
  }
}

main().catch(console.error);
