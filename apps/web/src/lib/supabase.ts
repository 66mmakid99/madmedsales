// C:\medcode\madmedsales\apps\web\src\lib\supabase.ts
import { createClient } from '@supabase/supabase-js';

// Astro(Vite) 환경에서는 클라이언트 접근을 위해 PUBLIC_ 접두사가 붙은 환경 변수를 사용합니다.
const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Supabase 환경 변수가 연결되지 않았습니다 (.env 파일을 확인하세요)");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * 안전한 의료기기 데이터 저장 (Select-then-Update)
 * sales_medical_devices 테이블의 중복 생성을 원천 차단합니다.
 * @param deviceData 저장할 장비 데이터 객체
 */
export async function upsertMedicalDevice(deviceData: any) {
  // 1. 이름 추출 및 검증
  const nameToBind = deviceData.name || deviceData.model_name || deviceData.device_name;
  
  if (!nameToBind || nameToBind.trim() === '') {
    console.warn('⚠️ 이름이 없는 장비 데이터는 저장하지 않습니다.', deviceData);
    return { data: null, error: '장비명이 없습니다.' };
  }

  const normName = nameToBind.trim();

  // 2. 기존 동일 이름 존재 여부 확인 (SELECT)
  const { data: existing, error: selectErr } = await supabase
    .from('sales_medical_devices')
    .select('id')
    // 완벽한 일치를 찾거나 대소문자 무시 매칭 등 정책에 맞게 (우선 ilike로 잡아냅니다)
    .ilike('name', normName)
    .limit(1);

  if (selectErr) {
    console.error('❌ 레코드 검색 에러:', selectErr.message);
    return { data: null, error: selectErr };
  }

  // 3. 존재하면 UPDATE, 없으면 INSERT
  if (existing && existing.length > 0) {
    // 기존 레코드 덮어쓰기 로직
    const targetId = existing[0].id;
    const { data: updated, error: updateErr } = await supabase
      .from('sales_medical_devices')
      .update({
        ...deviceData,
        name: normName, // 명확히 설정
        updated_at: new Date().toISOString()
      })
      .eq('id', targetId);
      
    return { data: updated, error: updateErr, action: 'UPDATE' };
  } else {
    // 완전 신규 레코드 생성
    const { data: inserted, error: insertErr } = await supabase
      .from('sales_medical_devices')
      .insert({
        ...deviceData,
        name: normName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    return { data: inserted, error: insertErr, action: 'INSERT' };
  }
}
