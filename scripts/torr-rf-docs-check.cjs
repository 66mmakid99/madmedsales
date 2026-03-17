const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const mapping = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'madmedscv', 'scripts', 'torr-rf-hospital-ids.json'),'utf8'));
  const ids = mapping.map(m => m.hospitalId);

  // Get all doctors for these hospitals
  const { data: docs } = await sb.from('hospital_doctors').select('hospital_id, name, position, specialty').in('hospital_id', ids);

  const docMap = {};
  if (docs) {
    for (const d of docs) {
      if (!docMap[d.hospital_id]) docMap[d.hospital_id] = [];
      docMap[d.hospital_id].push(d);
    }
  }

  console.log('Total doctors found:', (docs||[]).length);
  for (const [hid, dlist] of Object.entries(docMap)) {
    const h = mapping.find(m => m.hospitalId === hid);
    console.log('#' + (h ? h.no : '?'), (h ? h.name : hid) + ':', dlist.length + '명', dlist.map(d => d.name).join(', '));
  }

  // Check page counts
  const { data: pages } = await sb.from('scv_crawl_pages').select('hospital_id, pass_number').in('hospital_id', ids);
  const pageMap = {};
  if (pages) {
    for (const p of pages) {
      pageMap[p.hospital_id] = (pageMap[p.hospital_id] || 0) + 1;
    }
  }

  console.log('\nPages per hospital:');
  for (const m of mapping.sort((a,b) => a.no - b.no)) {
    const pc = pageMap[m.hospitalId] || 0;
    const dc = (docMap[m.hospitalId] || []).length;
    if (pc > 0 || dc > 0) {
      console.log('  #' + m.no, m.name + ':', pc + 'p', dc + 'd');
    }
  }

  // DNA check - maybe needs different hospital IDs
  const { data: allDna, error: dnaErr } = await sb.from('scv_crawl_dna').select('hospital_id, site_type').limit(5);
  console.log('\nscv_crawl_dna sample:', allDna ? allDna.length : 0, 'rows total', dnaErr ? dnaErr.message : '');
  if (allDna) allDna.forEach(d => console.log('  ', d.hospital_id, d.site_type));
}
run();
