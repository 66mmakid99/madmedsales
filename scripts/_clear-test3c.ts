import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  // hospital_crawl_pages에서 포에버 관련 hospital_id 찾기
  const { data: pages } = await supabase
    .from('hospital_crawl_pages')
    .select('hospital_id, url, page_type, char_count')
    .limit(100);

  if (!pages || pages.length === 0) {
    console.log('No crawl pages found at all');
    return;
  }

  // Group by hospital_id
  const byHospital = new Map<string, typeof pages>();
  for (const p of pages) {
    const arr = byHospital.get(p.hospital_id) || [];
    arr.push(p);
    byHospital.set(p.hospital_id, arr);
  }

  console.log(`Found ${byHospital.size} hospitals in crawl_pages:`);
  for (const [hid, pgs] of byHospital) {
    // Get hospital name
    const { data: hosp } = await supabase.from('hospitals').select('name').eq('id', hid).single();
    const name = hosp?.name || 'UNKNOWN';
    console.log(`\n${name} (${hid}):`);
    for (const p of pgs) {
      console.log(`  ${p.page_type.padEnd(12)} ${String(p.char_count).padStart(6)}자  ${p.url.substring(0, 80)}`);
    }

    // Clear data for this hospital
    const d1 = await supabase.from('hospital_doctors').delete().eq('hospital_id', hid);
    const d2 = await supabase.from('hospital_treatments').delete().eq('hospital_id', hid);
    const d3 = await supabase.from('hospital_equipments').delete().eq('hospital_id', hid);
    const d4 = await supabase.from('hospital_events').delete().eq('hospital_id', hid);
    await supabase.from('hospital_crawl_pages').update({ gemini_analyzed: false }).eq('hospital_id', hid);
    console.log(`  → cleared all analysis data`);
  }
}

main().catch(console.error);
