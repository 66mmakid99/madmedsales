import { supabase } from '../utils/supabase.js';

const { data, error } = await supabase
  .from('hospitals')
  .select('department, hospital_type, name')
  .limit(500);

if (error) { console.error(error); process.exit(1); }
const depts = [...new Set(data!.map((d: any) => d.department).filter(Boolean))].sort();
const types = [...new Set(data!.map((d: any) => d.hospital_type).filter(Boolean))].sort();
console.log('departments:', depts.join(', '));
console.log('types:', types.join(', '));

const skin = data!.filter((d: any) => d.department?.includes('피부') || d.name?.includes('피부'));
console.log('\n피부과 샘플:');
skin.slice(0, 8).forEach((d: any) => console.log(`  name=${d.name} | dept=${d.department} | type=${d.hospital_type}`));

// 피부과 전체 수 확인
const { count } = await supabase
  .from('hospitals')
  .select('*', { count: 'exact', head: true })
  .like('department', '%피부%');
console.log('\n피부과 dept like 전체 수:', count);

const { count: count2 } = await supabase
  .from('hospitals')
  .select('*', { count: 'exact', head: true })
  .or('department.like.%피부%,department.like.%성형%');
console.log('피부+성형 합계:', count2);
