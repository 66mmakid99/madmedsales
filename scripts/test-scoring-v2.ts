/**
 * 2단계 스코어링 테스트 (신사루비의원 1건)
 * 1단계 프로파일 → 2단계 TORR RF 매칭 → 2단계 2mm 니들 매칭 → 리드 생성
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(import.meta.dirname, '.env') });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── profiler.ts 로직 인라인 (engine은 Workers 환경이라 직접 import 불가) ──
// 대신 DB API를 직접 호출하는 방식으로 테스트

const HOSPITAL_NAME = '신사루비의원';

async function findHospital(): Promise<string> {
  const { data, error } = await supabase
    .from('hospitals')
    .select('id, name')
    .ilike('name', `%${HOSPITAL_NAME}%`)
    .limit(1)
    .single();

  if (error || !data) throw new Error(`병원 찾기 실패: ${error?.message}`);
  console.log(`\n✅ 병원: ${data.name} (${data.id})`);
  return data.id;
}

async function testProfile(hospitalId: string): Promise<void> {
  console.log('\n═══ 1단계: 병원 프로파일 생성 ═══');

  // profiler.ts의 로직을 직접 실행 (scripts 환경)
  const { profileSingleHospital } = await import(
    '../apps/engine/src/services/scoring/profiler.js'
  );

  const result = await profileSingleHospital(supabase, hospitalId);

  if (!result.success) {
    console.error('❌ 프로파일 실패:', result.error);
    return;
  }

  const p = result.profile!;
  console.log(`  투자 성향: ${p.investment_score}`);
  console.log(`  포트폴리오 다양성: ${p.portfolio_diversity_score}`);
  console.log(`  시술 규모: ${p.practice_scale_score}`);
  console.log(`  상권 경쟁: ${p.market_competition_score}`);
  console.log(`  온라인 존재감: ${p.online_presence_score}`);
  console.log(`  종합 점수: ${p.profile_score}`);
  console.log(`  등급: ${p.profile_grade}`);
  console.log(`  투자 성향: ${p.investment_tendency}`);

  // DB 저장 확인
  const { data: saved } = await supabase
    .from('sales_hospital_profiles')
    .select('id, profile_grade, profile_score')
    .eq('hospital_id', hospitalId)
    .single();

  console.log(`  DB 저장: ${saved ? '✅' : '❌'} (id: ${saved?.id})`);
}

async function testMatch(hospitalId: string, productCode: string): Promise<string | null> {
  console.log(`\n═══ 2단계: ${productCode} 매칭 ═══`);

  // 제품 ID 조회
  const { data: product } = await supabase
    .from('sales_products')
    .select('id, name')
    .eq('code', productCode)
    .single();

  if (!product) {
    console.error(`❌ 제품 찾기 실패: ${productCode}`);
    return null;
  }

  const { matchSingleHospitalProduct } = await import(
    '../apps/engine/src/services/scoring/matcher.js'
  );

  const result = await matchSingleHospitalProduct(supabase, hospitalId, product.id);

  if (!result.success) {
    console.error('❌ 매칭 실패:', result.error);
    return null;
  }

  const m = result.matchScore!;
  console.log(`  제품: ${product.name}`);
  console.log(`  Need Score: ${m.need_score}`);
  console.log(`  Fit Score: ${m.fit_score}`);
  console.log(`  Timing Score: ${m.timing_score}`);
  console.log(`  총점: ${m.total_score}`);
  console.log(`  등급: ${m.grade}`);

  // DB 저장 확인
  const { data: saved } = await supabase
    .from('product_match_scores')
    .select('id, grade, total_score')
    .eq('hospital_id', hospitalId)
    .eq('product_id', product.id)
    .single();

  console.log(`  DB 저장: ${saved ? '✅' : '❌'} (id: ${saved?.id})`);

  return m.id;
}

async function testLeadGeneration(hospitalId: string, productCode: string): Promise<void> {
  console.log(`\n═══ 리드 자동 생성: ${productCode} ═══`);

  const { data: product } = await supabase
    .from('sales_products')
    .select('id')
    .eq('code', productCode)
    .single();

  if (!product) return;

  const { data: matchScore } = await supabase
    .from('product_match_scores')
    .select('*')
    .eq('hospital_id', hospitalId)
    .eq('product_id', product.id)
    .single();

  if (!matchScore) {
    console.log('  매칭 결과 없음 → 리드 생성 건너뜀');
    return;
  }

  const { autoCreateLeadFromMatch } = await import(
    '../apps/engine/src/services/scoring/lead-generator.js'
  );

  const result = await autoCreateLeadFromMatch(supabase, matchScore);
  console.log(`  생성 여부: ${result.created ? '✅ 생성됨' : '⏭ 건너뜀'}`);
  console.log(`  사유: ${result.reason ?? '성공'}`);
  if (result.leadId) {
    console.log(`  리드 ID: ${result.leadId}`);

    // DB 확인
    const { data: lead } = await supabase
      .from('leads')
      .select('id, product_id, grade, priority, contact_email, stage')
      .eq('id', result.leadId)
      .single();

    if (lead) {
      console.log(`  리드 상세: grade=${lead.grade}, priority=${lead.priority}, stage=${lead.stage}`);
      console.log(`  product_id: ${lead.product_id}`);
      console.log(`  contact_email: ${lead.contact_email}`);
    }
  }
}

async function main(): Promise<void> {
  console.log('🧪 2단계 스코어링 테스트 시작');
  console.log('─'.repeat(50));

  const hospitalId = await findHospital();

  // 1단계: 프로파일
  await testProfile(hospitalId);

  // 2단계: TORR RF 매칭
  await testMatch(hospitalId, 'torr-rf');

  // 2단계: 2mm 니들 매칭
  await testMatch(hospitalId, 'needle-2mm');

  // 리드 생성
  await testLeadGeneration(hospitalId, 'torr-rf');
  await testLeadGeneration(hospitalId, 'needle-2mm');

  console.log('\n─'.repeat(50));
  console.log('🏁 테스트 완료');
}

main().catch(console.error);
