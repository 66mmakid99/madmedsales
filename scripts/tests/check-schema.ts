// @deprecated 구 스키마 검증 스크립트. hospital_equipments → sales_hospital_equipments, hospital_treatments → sales_hospital_treatments
import { supabase } from '../utils/supabase.js';

// RPC로 실제 스키마 확인
const { data, error } = await supabase.rpc('', {}).select();
console.log('rpc test:', error?.message);

// 직접 SQL로 테이블 확인
const { data: tables, error: tErr } = await supabase
  .from('information_schema.tables' as any)
  .select('table_schema, table_name')
  .in('table_name', ['hospital_equipments', 'hospital_treatments', 'hospital_doctors', 'hospitals', 'scv_crawl_pages']);

if (tErr) {
  console.log('information_schema 접근 불가:', tErr.message);

  // 대안: hospitals는 되고 hospital_equipments는 안되니, 차이를 확인
  const { count: c1 } = await supabase.from('hospitals').select('*', { count: 'exact', head: true });
  console.log('hospitals count:', c1);

  // hospital_equipments - select 시도
  const { data: eq, error: eqErr } = await supabase.from('sales_hospital_equipments').select('*').limit(1);
  console.log('hospital_equipments SELECT:', eqErr?.message || 'OK', eq?.length);

  // hospital_treatments - select 시도
  const { data: tr, error: trErr } = await supabase.from('sales_hospital_treatments').select('*').limit(1);
  console.log('hospital_treatments SELECT:', trErr?.message || 'OK', tr?.length);
}
