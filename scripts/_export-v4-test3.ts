import { supabase } from './utils/supabase.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const targets = [
  { name: '안산엔비의원', hid: '1267b395-1132-4511-a8ba-1afc228a8867' },
  { name: '동안중심의원', hid: '7b169807-6d76-4796-a31b-7b35f0437899' },
  { name: '포에버의원(신사)', hid: '92f7b52a-66e9-4b1c-a118-6058f89db92e' },
];

async function main(): Promise<void> {
  const outDir = path.resolve(__dirname, 'data', 'v4-test3');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  for (const t of targets) {
    const { data: pages } = await supabase
      .from('hospital_crawl_pages')
      .select('url, page_type, char_count, screenshot_url, analysis_method, gemini_analyzed')
      .eq('hospital_id', t.hid)
      .order('crawled_at');

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
      .select('equipment_name, equipment_brand, equipment_category, manufacturer')
      .eq('hospital_id', t.hid);

    const { data: events } = await supabase
      .from('hospital_events')
      .select('title, description, discount_type, discount_value, related_treatments')
      .eq('hospital_id', t.hid);

    const report = {
      hospital: t.name,
      hospital_id: t.hid,
      exported_at: new Date().toISOString(),
      summary: {
        pages: pages?.length || 0,
        doctors: doctors?.length || 0,
        treatments: treatments?.length || 0,
        equipments: equipments?.length || 0,
        events: events?.length || 0,
      },
      crawl_pages: pages || [],
      doctors: doctors || [],
      treatments: treatments || [],
      equipments: equipments || [],
      events: events || [],
    };

    const safeName = t.name.replace(/[()]/g, '').replace(/\s+/g, '-');
    const filePath = path.resolve(outDir, `${safeName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
    console.log(`✅ ${t.name} → ${filePath}`);
  }
}

main().catch(console.error);
