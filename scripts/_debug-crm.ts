import { supabase } from './utils/supabase.js';

async function main(): Promise<void> {
  const { data, error } = await supabase.from('crm_hospitals').select('*').limit(1);
  if (error) {
    console.log('Error:', error.message);
    return;
  }
  if (data && data[0]) {
    console.log('Columns:', Object.keys(data[0]).join(', '));
  }

  const { count: total } = await supabase
    .from('crm_hospitals')
    .select('id', { count: 'exact', head: true });

  const { count: linked } = await supabase
    .from('crm_hospitals')
    .select('id', { count: 'exact', head: true })
    .not('sales_hospital_id', 'is', null);

  console.log(`Total: ${total}, Linked: ${linked}`);

  // Sample some linked ones
  const { data: sample } = await supabase
    .from('crm_hospitals')
    .select('name, sales_hospital_id')
    .not('sales_hospital_id', 'is', null)
    .limit(5);

  if (sample) {
    sample.forEach((s) => console.log(`  ${s.name} → ${s.sales_hospital_id}`));
  } else {
    console.log('No linked hospitals found');
    // Show any with non-null
    const { data: all } = await supabase
      .from('crm_hospitals')
      .select('name, sales_hospital_id')
      .limit(5);
    console.log('Sample (all):', JSON.stringify(all));
  }
}

main().catch(console.error);
