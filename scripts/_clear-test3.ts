import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  const names = ['안산엔비의원', '동안중심의원', '포에버의원'];
  for (const name of names) {
    const { data: crm } = await supabase
      .from('crm_hospitals')
      .select('sales_hospital_id')
      .eq('name', name)
      .single();
    if (!crm?.sales_hospital_id) { console.log(name + ': no hospital_id'); continue; }
    const hid = crm.sales_hospital_id;
    console.log(name + ' → ' + hid);

    const d1 = await supabase.from('hospital_doctors').delete().eq('hospital_id', hid);
    const d2 = await supabase.from('hospital_treatments').delete().eq('hospital_id', hid);
    const d3 = await supabase.from('hospital_equipments').delete().eq('hospital_id', hid);
    const d4 = await supabase.from('hospital_events').delete().eq('hospital_id', hid);
    console.log('  deleted: doctors=' + (d1.error?.message || 'ok') +
      ', treatments=' + (d2.error?.message || 'ok') +
      ', equipments=' + (d3.error?.message || 'ok') +
      ', events=' + (d4.error?.message || 'ok'));

    await supabase.from('hospital_crawl_pages').update({ gemini_analyzed: false }).eq('hospital_id', hid);
    console.log('  reset gemini_analyzed');
  }
}

main().catch(console.error);
