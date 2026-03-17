import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import { supabase } from '../utils/supabase.js';

async function main() {
  const { data } = await supabase
    .from('hospitals')
    .select('sido, sigungu, name')
    .in('department', ['피부과', '성형외과'])
    .eq('status', 'active')
    .not('sido', 'is', null)
    .limit(30);

  const sidoSet = new Set(data?.map(h => h.sido) ?? []);
  console.log('sido 값 샘플:', [...sidoSet].slice(0, 15));
  console.log('\nDB 레코드 샘플:');
  data?.slice(0, 15).forEach(h => console.log(`  sido=[${h.sido}] sigungu=[${h.sigungu}] name=${h.name}`));

  // "부산"으로 필터링해서 sido 실제 값 확인
  const { data: busanData } = await supabase
    .from('hospitals')
    .select('sido, sigungu')
    .ilike('sido', '%부산%')
    .in('department', ['피부과', '성형외과'])
    .limit(5);
  console.log('\n부산 관련 sido:', busanData?.map(h => h.sido));
}

main().catch(console.error);
