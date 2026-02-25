import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

const FINAL_TREAT_MAP = {
  'anti-aging': '리프팅',
  'injectable': '필러/주사',
  'pigmentation': '레이저',
  'program': '기타',
  'acne_cosmetic': '스킨케어',
  'botulinum_toxin': '필러/주사',
  'contouring': '리프팅',
  'dermal_filler': '필러/주사',
  'lifting_thread': '리프팅',
  'moisturizing': '스킨케어',
  'pore_treatment': '레이저',
  'regeneration': '스킨케어',
  'skin_booster': '부스터',
  'skin_care': '스킨케어',
  'stretch_mark': '레이저',
  'thread_lifting': '리프팅',
  'volume': '필러/주사',
  'weight_loss': '바디',
  'freckle': '레이저',
  'melasma': '레이저',
  'rejuvenation': '스킨케어',
  'spot': '레이저',
  'tone': '레이저',
  'skin_tone': '레이저',
  'fat_dissolving': '바디',
};

async function main() {
  // Get all remaining non-Korean categories
  const { data: remaining } = await supabase
    .from('hospital_treatments')
    .select('treatment_category')
    .not('treatment_category', 'in', '("기타","리프팅","필러/주사","레이저","바디","부스터","스킨케어","탈모/모발","RF","HIFU","성형")');
  
  const remCount = {};
  (remaining || []).forEach(r => {
    const cat = r.treatment_category || '(null)';
    remCount[cat] = (remCount[cat] || 0) + 1;
  });
  
  if (Object.keys(remCount).length > 0) {
    console.log('정규화 전 잔여 영문 카테고리:');
    Object.entries(remCount).sort((a,b) => b[1] - a[1]).forEach(([c, n]) => {
      console.log(`  ${c}: ${n}건`);
    });
  }

  // Apply final map
  let updated = 0;
  for (const [from, to] of Object.entries(FINAL_TREAT_MAP)) {
    const { data } = await supabase
      .from('hospital_treatments')
      .update({ treatment_category: to })
      .eq('treatment_category', from)
      .select('id');
    if (data && data.length > 0) {
      updated += data.length;
    }
  }

  // Catch-all: any remaining non-Korean category → 기타
  const { data: stillRemaining } = await supabase
    .from('hospital_treatments')
    .select('id, treatment_category')
    .not('treatment_category', 'in', '("기타","리프팅","필러/주사","레이저","바디","부스터","스킨케어","탈모/모발","RF","HIFU","성형")');
  
  if (stillRemaining && stillRemaining.length > 0) {
    const ids = stillRemaining.map(r => r.id);
    // Show what we're catching
    const leftover = {};
    stillRemaining.forEach(r => { leftover[r.treatment_category] = (leftover[r.treatment_category] || 0) + 1; });
    console.log('\nCatch-all → 기타:');
    Object.entries(leftover).forEach(([c, n]) => console.log(`  ${c}: ${n}건`));
    
    // Update in batches of 100
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await supabase.from('hospital_treatments').update({ treatment_category: '기타' }).in('id', batch);
    }
    updated += stillRemaining.length;
  }

  console.log(`\n추가 정규화: ${updated}건\n`);

  // Also clean up equipment - catch-all remaining
  const { data: eqRemaining } = await supabase
    .from('hospital_equipments')
    .select('id, equipment_category')
    .not('equipment_category', 'in', '("기타","리프팅","필러/주사","레이저","바디","부스터","스킨케어","탈모/모발","RF","HIFU","성형")');
  
  if (eqRemaining && eqRemaining.length > 0) {
    const leftover = {};
    eqRemaining.forEach(r => { leftover[r.equipment_category] = (leftover[r.equipment_category] || 0) + 1; });
    console.log('장비 잔여 카테고리 → 기타:');
    Object.entries(leftover).forEach(([c, n]) => console.log(`  ${c}: ${n}건`));
    
    const ids = eqRemaining.map(r => r.id);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      await supabase.from('hospital_equipments').update({ equipment_category: '기타' }).in('id', batch);
    }
  }

  // === FINAL DISTRIBUTION ===
  console.log('\n=== 최종 장비 카테고리 분포 ===');
  const { data: eqFinal } = await supabase.from('hospital_equipments').select('equipment_category');
  const eqCount = {};
  (eqFinal || []).forEach(e => { eqCount[e.equipment_category || '(null)'] = (eqCount[e.equipment_category || '(null)'] || 0) + 1; });
  console.log('| 카테고리 | 건수 |');
  console.log('|----------|------|');
  Object.entries(eqCount).sort((a,b) => b[1] - a[1]).forEach(([c, n]) => console.log(`| ${c} | ${n} |`));
  console.log(`| **합계** | **${(eqFinal||[]).length}** |`);

  console.log('\n=== 최종 시술 카테고리 분포 ===');
  const { data: trFinal } = await supabase.from('hospital_treatments').select('treatment_category');
  const trCount = {};
  (trFinal || []).forEach(t => { trCount[t.treatment_category || '(null)'] = (trCount[t.treatment_category || '(null)'] || 0) + 1; });
  console.log('| 카테고리 | 건수 |');
  console.log('|----------|------|');
  Object.entries(trCount).sort((a,b) => b[1] - a[1]).forEach(([c, n]) => console.log(`| ${c} | ${n} |`));
  console.log(`| **합계** | **${(trFinal||[]).length}** |`);
}

main().catch(console.error);
