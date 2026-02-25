import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const hospitalIds = [
  '1267b395-1132-4511-a8ba-1afc228a8867', // 안산엔비의원
  '7b169807-6d76-4796-a31b-7b35f0437899', // 동안중심의원
  '92f7b52a-66e9-4b1c-a118-6058f89db92e', // 포에버의원(신사)
];

async function main() {
  for (const id of hospitalIds) {
    console.log(`\n${'='.repeat(80)}`);
    
    // Hospital basic info
    const { data: hospital } = await supabase
      .from('hospitals')
      .select('id, name, address, phone, website, crawled_at, crawl_version')
      .eq('id', id)
      .single();
    console.log(`\n## HOSPITAL: ${hospital?.name}`);
    console.log(JSON.stringify(hospital, null, 2));

    // Equipment
    const { data: equipment } = await supabase
      .from('hospital_equipments')
      .select('equipment_name, equipment_category, manufacturer')
      .eq('hospital_id', id);
    console.log(`\n### EQUIPMENT (${equipment?.length || 0}):`);
    console.log(JSON.stringify(equipment, null, 2));

    // Treatments
    const { data: treatments } = await supabase
      .from('hospital_treatments')
      .select('treatment_name, treatment_category, price, price_note, is_promoted, combo_with')
      .eq('hospital_id', id);
    console.log(`\n### TREATMENTS (${treatments?.length || 0}):`);
    console.log(JSON.stringify(treatments, null, 2));

    // Doctors
    const { data: doctors } = await supabase
      .from('hospital_doctors')
      .select('name, title, specialty, education, career, academic_activity, notes')
      .eq('hospital_id', id);
    console.log(`\n### DOCTORS (${doctors?.length || 0}):`);
    console.log(JSON.stringify(doctors, null, 2));

    // Events
    const { data: events } = await supabase
      .from('hospital_events')
      .select('title, description, discount_type, discount_value, related_treatments')
      .eq('hospital_id', id);
    console.log(`\n### EVENTS (${events?.length || 0}):`);
    console.log(JSON.stringify(events, null, 2));

    // Crawl pages
    const { data: pages } = await supabase
      .from('hospital_crawl_pages')
      .select('page_url, page_type, content_type, char_count, screenshot_url, crawl_version')
      .eq('hospital_id', id)
      .order('created_at', { ascending: true });
    console.log(`\n### CRAWL PAGES (${pages?.length || 0}):`);
    console.log(JSON.stringify(pages, null, 2));

    // Validation
    const { data: validations } = await supabase
      .from('hospital_crawl_validations')
      .select('*')
      .eq('hospital_id', id)
      .order('created_at', { ascending: false })
      .limit(1);
    console.log(`\n### VALIDATION:`);
    console.log(JSON.stringify(validations, null, 2));

    // Previous crawl data (v4)
    const { data: prevValidations } = await supabase
      .from('hospital_crawl_validations')
      .select('*')
      .eq('hospital_id', id)
      .order('created_at', { ascending: true })
      .limit(1);
    console.log(`\n### PREV VALIDATION (v4):`);
    console.log(JSON.stringify(prevValidations, null, 2));
  }
}

main().catch(console.error);
