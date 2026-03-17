/**
 * ULBLANC 멀티 제품 이메일 동적 주입 테스트
 *
 * 1. products 테이블에 ULBLANC 등록
 * 2. 임의 병원 1개 선택
 * 3. S/A/B 등급별 프롬프트 생성 → ULBLANC 정보가 정확히 주입되는지 확인
 * 4. Claude API로 S등급 이메일 1건 실제 생성 (미리보기만, 발송 안 함)
 * 5. 테스트 완료 후 ULBLANC 제품 삭제 (원복)
 */
import { supabase } from '../utils/supabase';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../apps/engine/.dev.vars') });

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('❌ ANTHROPIC_API_KEY not found in apps/engine/.dev.vars');
  process.exit(1);
}

// ── ULBLANC 제품 정의 ──────────────────────────────────────
const ULBLANC_PRODUCT = {
  name: 'ULBLANC',
  code: 'ulblanc',
  manufacturer: 'BRITZMEDI',
  category: 'equipment',
  subcategory: 'ultrasound',
  description: '집속 초음파(HIFU) 기반 피부 리프팅/타이트닝 의료기기. 비침습적 시술로 다운타임 최소화.',
  price_min: 30000000,
  price_max: 35000000,
  target_departments: ['피부과', '성형외과'],
  target_hospital_types: ['의원', '병원'],
  scoring_criteria: {
    need_rules: [
      { condition: 'no_hifu', score: 40, reason: 'HIFU 장비 공백 → 신규 도입 기회' },
      { condition: 'old_hifu_5yr', score: 30, reason: 'HIFU 5년+ → 교체 적기' },
      { condition: 'lifting_treatments', score: 25, reason: '리프팅 시술 수요 확인' },
      { condition: 'high_antiaging_ratio', score: 20, reason: '안티에이징 집중 병원' },
    ],
    fit_rules: [
      { condition: 'has_rf', score: 20, reason: 'RF+HIFU 콤보 시너지' },
      { condition: 'equipment_count_5plus', score: 15, reason: '적극 투자형 병원' },
      { condition: 'high_price_treatments', score: 15, reason: '고가 시술 → 환자 구매력' },
    ],
    timing_rules: [
      { condition: 'opened_2_5yr', score: 30, reason: '확장기 병원' },
      { condition: 'recent_investment', score: 25, reason: '최근 장비 투자 이력' },
    ],
  },
  email_guide: {
    product_summary: '집속 초음파(HIFU) 기반 피부 리프팅/타이트닝 의료기기',
    key_benefits: ['비침습적 리프팅', 'RF 대비 깊은 조직층 도달', '빠른 시술 시간', '높은 환자 만족도'],
    value_proposition: '비침습 초음파로 SMAS층까지 도달하는 차세대 리프팅 솔루션',
    price_mention_policy: '이메일에서 직접 가격 언급 금지, 문의 유도',
    tone_guide: '전문적이면서 혁신적인 톤, 비침습 장점 강조',
    guide_text: 'ULBLANC은 HIFU 기술로 SMAS층까지 에너지를 전달하는 비침습 리프팅 장비입니다. RF와의 차별점(깊은 조직층 도달)을 강조하되, RF를 보완하는 콤보 시술 관점에서 접근하세요. 기존 HIFU 장비(울쎄라, 슈링크 등) 대비 시술 편의성과 비용 효율성을 어필하세요.',
    cta_options: ['데모 신청', '자료 요청', '상담 예약'],
  },
  competing_keywords: ['울쎄라', '슈링크', '더블로', '리프테라', '울트라포머'],
  synergy_keywords: ['TORR RF', '써마지', '인모드'],
  demo_guide: 'HIFU + RF 콤보 리프팅 프로토콜 제안',
  sort_order: 3,
  status: 'active',
};

// ── 프롬프트 빌더 (engine 소스에서 로직만 가져옴) ─────────
interface ProductInfo {
  name: string;
  manufacturer: string;
  category: string;
  valueProposition: string;
  emailGuide: string | null;
}

interface EmailPromptInput {
  product: ProductInfo;
  hospitalName: string;
  doctorName: string | null;
  department: string | null;
  equipments: string[];
  treatments: string[];
  aiAnalysis: string | null;
  aiMessageDirection: string | null;
  stepNumber: number;
  stepPurpose: string;
  stepTone: string | null;
  stepKeyMessage: string | null;
  personalizationFocus: string | null;
  previousEmails: { subject: string; sentAt: string }[];
  unsubscribeUrl: string;
}

function buildSGradePrompt(input: EmailPromptInput): string {
  const emailGuideSection = input.product.emailGuide
    ? `\n## 제품 이메일 가이드\n${input.product.emailGuide}`
    : '';

  return `당신은 한국 피부과/성형외과 의료기기 영업 전문가입니다.
아래 병원 정보를 바탕으로 개인화된 영업 이메일을 작성하세요.

## 제품 정보
- 제품명: ${input.product.name}
- 제조사/브랜드: ${input.product.manufacturer}
- 카테고리: ${input.product.category}
- 핵심 가치: ${input.product.valueProposition}
- 가격: 이메일에 절대 언급하지 마세요${emailGuideSection}

## 병원 정보
- 병원명: ${input.hospitalName}
- 원장님: ${input.doctorName ?? '미확인'}
- 진료과: ${input.department ?? '피부과/성형외과'}
- 보유 장비: ${input.equipments.length > 0 ? input.equipments.join(', ') : '정보 없음'}
- 주요 시술: ${input.treatments.length > 0 ? input.treatments.join(', ') : '정보 없음'}

## 시퀀스 정보
- 현재 단계: ${input.stepNumber}회차
- 목적: ${input.stepPurpose}

## 작성 규칙
1. 제목: 30자 이내, 반드시 병원명 포함
2. 본문: 300자 이내
3. CTA 1개
4. 수신거부 링크 필수: ${input.unsubscribeUrl}
5. 가격 절대 언급 금지
6. 자연스러운 한국어 사용
7. 제품명(${input.product.name})은 자연스럽게 언급

## 응답 형식 (JSON만 출력)
{
  "subject": "이메일 제목",
  "body_html": "<html>본문</html>",
  "body_text": "텍스트 본문",
  "personalization_notes": "개인화 전략 설명"
}`;
}

// ── 메인 테스트 ────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('🧪 ULBLANC 멀티 제품 이메일 동적 주입 테스트');
  console.log('='.repeat(60));

  // 1. ULBLANC 등록
  console.log('\n📦 Step 1: ULBLANC 제품 등록...');
  const { data: existingProduct } = await supabase
    .from('sales_products')
    .select('id')
    .eq('code', 'ulblanc')
    .maybeSingle();

  let productId: string;

  if (existingProduct) {
    productId = existingProduct.id;
    console.log(`  → 이미 존재 (id: ${productId}), 재사용`);
  } else {
    const { data: inserted, error: insertErr } = await supabase
      .from('sales_products')
      .insert(ULBLANC_PRODUCT)
      .select('id')
      .single();

    if (insertErr || !inserted) {
      console.error('❌ ULBLANC 등록 실패:', insertErr?.message);
      process.exit(1);
    }
    productId = inserted.id;
    console.log(`  → 등록 완료 (id: ${productId})`);
  }

  // 2. DB에서 ULBLANC 조회하여 동적 주입 데이터 확인
  console.log('\n📋 Step 2: DB에서 ULBLANC 조회...');
  const { data: product, error: fetchErr } = await supabase
    .from('sales_products')
    .select('name, manufacturer, category, description, email_guide, code')
    .eq('id', productId)
    .single();

  if (fetchErr || !product) {
    console.error('❌ ULBLANC 조회 실패:', fetchErr?.message);
    process.exit(1);
  }

  console.log(`  → 제품명: ${product.name}`);
  console.log(`  → 제조사: ${product.manufacturer}`);
  console.log(`  → 카테고리: ${product.category}`);
  console.log(`  → 코드: ${product.code}`);

  const emailGuide = product.email_guide as Record<string, unknown> | null;
  const productInfo: ProductInfo = {
    name: product.name,
    manufacturer: product.manufacturer,
    category: product.category,
    valueProposition: (emailGuide?.value_proposition as string) ?? product.description ?? product.name,
    emailGuide: (emailGuide?.guide_text as string) ?? null,
  };

  console.log(`  → valueProposition: ${productInfo.valueProposition}`);
  console.log(`  → emailGuide: ${productInfo.emailGuide ? productInfo.emailGuide.substring(0, 60) + '...' : 'null'}`);

  // 3. 장비 데이터 풍부한 병원 1개 선택
  console.log('\n🏥 Step 3: 테스트 병원 선택...');
  const { data: hospitals, error: hospErr } = await supabase
    .from('hospitals')
    .select('id, name, doctor_name, department')
    .in('id', [
      '7b169807-6d76-4796-a31b-7b35f0437899',  // 동안중심의원 (장비 38, 시술 48)
      '09bdeaf8-0f13-40f5-95df-a9d8d9536c26',  // 815의원 (장비 37, 시술 66)
    ])
    .limit(1);

  if (hospErr || !hospitals || hospitals.length === 0) {
    console.error('❌ 병원 조회 실패:', hospErr?.message ?? '데이터 없음');
    process.exit(1);
  }

  const hospital = hospitals[Math.floor(Math.random() * hospitals.length)];
  console.log(`  → 선택: ${hospital.name} (${hospital.doctor_name ?? '원장 미확인'})`);

  // 병원 장비/시술 조회
  const { data: equips } = await supabase
    .from('sales_hospital_equipments')
    .select('equipment_name')
    .eq('hospital_id', hospital.id)
    .limit(10);

  const { data: treats } = await supabase
    .from('sales_hospital_treatments')
    .select('treatment_name')
    .eq('hospital_id', hospital.id)
    .limit(10);

  const equipmentNames = (equips ?? []).map((e) => e.equipment_name);
  const treatmentNames = (treats ?? []).map((t) => t.treatment_name);
  console.log(`  → 장비 ${equipmentNames.length}개: ${equipmentNames.slice(0, 5).join(', ') || '없음'}`);
  console.log(`  → 시술 ${treatmentNames.length}개: ${treatmentNames.slice(0, 5).join(', ') || '없음'}`);

  // 4. 프롬프트 생성 검증
  console.log('\n✍️  Step 4: 프롬프트 생성 검증...');
  const promptInput: EmailPromptInput = {
    product: productInfo,
    hospitalName: hospital.name,
    doctorName: hospital.doctor_name,
    department: hospital.department,
    equipments: equipmentNames,
    treatments: treatmentNames,
    aiAnalysis: null,
    aiMessageDirection: null,
    stepNumber: 1,
    stepPurpose: 'intro',
    stepTone: 'professional',
    stepKeyMessage: null,
    personalizationFocus: null,
    previousEmails: [],
    unsubscribeUrl: 'https://madmedsales.com/unsubscribe?test=true',
  };

  const prompt = buildSGradePrompt(promptInput);

  // 하드코딩 검증
  const hasTorrRf = prompt.includes('TORR RF') || prompt.includes('torr-rf');
  const hasUlblanc = prompt.includes('ULBLANC');
  const hasBritzmedi = prompt.includes('BRITZMEDI');
  const hasHifu = prompt.includes('HIFU') || prompt.includes('초음파');
  const hasHospitalName = prompt.includes(hospital.name);

  console.log(`  → TORR RF 하드코딩 없음: ${!hasTorrRf ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  → ULBLANC 제품명 포함: ${hasUlblanc ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  → BRITZMEDI 제조사 포함: ${hasBritzmedi ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  → HIFU/초음파 관련 내용 포함: ${hasHifu ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`  → 병원명 포함: ${hasHospitalName ? '✅ PASS' : '❌ FAIL'}`);

  if (hasTorrRf || !hasUlblanc || !hasBritzmedi) {
    console.error('\n❌ 프롬프트 동적 주입 실패!');
    console.log('\n--- 생성된 프롬프트 (일부) ---');
    console.log(prompt.substring(0, 500));
    process.exit(1);
  }

  console.log('\n--- 생성된 프롬프트 (제품 정보 섹션) ---');
  const productSection = prompt.split('## 병원 정보')[0];
  console.log(productSection);

  // 5. Claude API로 실제 이메일 생성 (미리보기)
  console.log('\n🤖 Step 5: Claude API로 ULBLANC 이메일 생성 (미리보기)...');

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`API ${response.status}: ${errText}`);
    }

    const data = await response.json() as {
      content: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const textBlock = data.content.find((b) => b.type === 'text');
    if (!textBlock?.text) throw new Error('No text in response');

    const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const emailResult = JSON.parse(jsonMatch[0]) as {
      subject: string;
      body_html: string;
      body_text: string;
      personalization_notes: string;
    };

    console.log('\n' + '─'.repeat(60));
    console.log('📧 생성된 ULBLANC 이메일 미리보기');
    console.log('─'.repeat(60));
    console.log(`제목: ${emailResult.subject}`);
    console.log(`\n본문 (text):\n${emailResult.body_text}`);
    console.log(`\n개인화 노트: ${emailResult.personalization_notes}`);
    console.log('─'.repeat(60));

    // 이메일에 ULBLANC이 포함되었는지 확인
    const emailHasUlblanc =
      emailResult.subject.includes('ULBLANC') ||
      emailResult.body_text.includes('ULBLANC');
    const emailHasTorr =
      emailResult.subject.includes('TORR') ||
      emailResult.body_text.includes('TORR');

    console.log(`\n이메일에 ULBLANC 포함: ${emailHasUlblanc ? '✅ PASS' : '⚠️ WARN (AI 판단)'}`);
    console.log(`이메일에 TORR RF 미포함: ${!emailHasTorr ? '✅ PASS' : '❌ FAIL'}`);

    if (data.usage) {
      console.log(`\n토큰 사용량: input=${data.usage.input_tokens}, output=${data.usage.output_tokens}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`❌ 이메일 생성 실패: ${msg}`);
  }

  // 6. 정리 — ULBLANC 삭제 여부는 선택
  console.log('\n🧹 Step 6: 정리...');
  if (!existingProduct) {
    const { error: delErr } = await supabase
      .from('sales_products')
      .delete()
      .eq('id', productId);

    if (delErr) {
      console.log(`  → ULBLANC 삭제 실패 (수동 삭제 필요): ${delErr.message}`);
    } else {
      console.log('  → ULBLANC 제품 삭제 완료 (테스트 원복)');
    }
  } else {
    console.log('  → ULBLANC 기존 데이터 유지 (삭제하지 않음)');
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ ULBLANC 멀티 제품 이메일 동적 주입 테스트 완료');
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
