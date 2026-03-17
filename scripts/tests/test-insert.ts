// @deprecated 구 INSERT 테스트. hospital_equipments → sales_hospital_equipments, hospital_treatments → sales_hospital_treatments
import { supabase } from '../utils/supabase.js';

const hospitalId = '87b4023e-e2f3-488b-9c7f-f36862c88cd3';

// 1. hospital_equipments INSERT 테스트
const { data: d1, error: e1 } = await supabase.from('sales_hospital_equipments').insert({
  hospital_id: hospitalId,
  equipment_name: 'TEST_EQUIPMENT',
  equipment_category: 'other',
  source: 'test',
}).select();
console.log('hospital_equipments INSERT:', e1?.message || 'OK', d1?.length);

// 2. hospital_treatments INSERT 테스트
const { data: d2, error: e2 } = await supabase.from('sales_hospital_treatments').insert({
  hospital_id: hospitalId,
  treatment_name: 'TEST_TREATMENT',
  treatment_category: 'other',
  source: 'test',
}).select();
console.log('hospital_treatments INSERT:', e2?.message || 'OK', d2?.length);

// 3. hospital_doctors INSERT 테스트
const { data: d3, error: e3 } = await supabase.from('hospital_doctors').insert({
  hospital_id: hospitalId,
  name: 'TEST_DOCTOR',
  title: '원장',
}).select();
console.log('hospital_doctors INSERT:', e3?.message || 'OK', d3?.length);

// cleanup
await supabase.from('sales_hospital_equipments').delete().eq('source', 'test');
await supabase.from('sales_hospital_treatments').delete().eq('source', 'test');
await supabase.from('hospital_doctors').delete().eq('name', 'TEST_DOCTOR');
console.log('cleanup done');
