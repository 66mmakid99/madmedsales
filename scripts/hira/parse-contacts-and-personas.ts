/**
 * Step 2: 연락처 파싱 + 대표원장/페이닥터 확정 분류
 *
 * 2-A: scv_crawl_pages markdown에서 연락처(이메일/전화/카카오톡) 정규식 추출
 * 2-B: hospital_doctors title + 푸터 패턴으로 대표원장/페이닥터 분류
 * 2-C: sales_personas 테이블에 저장
 *
 * 실행: npx tsx scripts/hira/parse-contacts-and-personas.ts
 * 옵션: --limit 100
 */
import { supabase } from '../utils/supabase.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('parse-contacts');

// ─── 2-A: 연락처 정규식 ─────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:0[2-9][0-9]?)[- ]?(?:[0-9]{3,4})[- ]?(?:[0-9]{4})/g;
const PHONE_1XXX_RE = /1[0-9]{3}[- ]?[0-9]{4}/g;
const KAKAO_RE = /(?:pf\.kakao\.com|open\.kakao\.com\/o)\/[a-zA-Z0-9_]+/g;

// 제외할 이메일 패턴 (환자 문의용이 아닌 것)
const EXCLUDE_EMAIL_PATTERNS = [
  /noreply/i,
  /no-reply/i,
  /admin@/i,
  /webmaster/i,
  /test@/i,
  /example\.com/i,
];

function extractContacts(markdowns: string[]): {
  email: string | null;
  phone: string | null;
  kakao: string | null;
} {
  const allText = markdowns.join('\n');

  // 이메일
  const emails = (allText.match(EMAIL_RE) ?? []).filter(
    (e) => !EXCLUDE_EMAIL_PATTERNS.some((p) => p.test(e))
  );
  const email = emails.length > 0 ? emails[0] : null;

  // 전화번호 — footer/contact 영역 우선
  const phones = [
    ...(allText.match(PHONE_RE) ?? []),
    ...(allText.match(PHONE_1XXX_RE) ?? []),
  ];
  const phone = phones.length > 0 ? phones[0].replace(/[- ]/g, '-') : null;

  // 카카오톡
  const kakaos = allText.match(KAKAO_RE) ?? [];
  const kakao = kakaos.length > 0 ? kakaos[0] : null;

  return { email, phone, kakao };
}

// ─── 2-B: 대표원장/페이닥터 분류 ─────────────────────

interface DoctorRow {
  id: string;
  hospital_id: string;
  name: string;
  title: string | null;
  specialty: string | null;
}

const REPRESENTATIVE_TITLES = ['대표원장', '대표', '원장(대표)', '병원장'];

function classifyDoctors(
  doctors: DoctorRow[],
  footerRepName: string | null
): {
  representativeCount: number;
  payDoctorCount: number;
  isSpecialist: boolean;
  specialistCountScv: number;
} {
  let representativeCount = 0;
  let payDoctorCount = 0;
  let specialistCountScv = 0;

  for (const doc of doctors) {
    const isRep =
      REPRESENTATIVE_TITLES.some((t) => doc.title?.includes(t)) ||
      (footerRepName && doc.name === footerRepName);

    if (isRep) {
      representativeCount++;
    } else {
      payDoctorCount++;
    }

    if (doc.specialty?.includes('전문의')) {
      specialistCountScv++;
    }
  }

  // 의사가 1명이면 무조건 대표원장
  if (doctors.length === 1) {
    representativeCount = 1;
    payDoctorCount = 0;
  }

  const isSpecialist = specialistCountScv > 0;

  return { representativeCount, payDoctorCount, isSpecialist, specialistCountScv };
}

function extractFooterRepName(markdowns: string[]): string | null {
  for (const md of markdowns) {
    // "대표: 홍길동" 또는 "대표원장: 홍길동" 패턴
    const match = md.match(/대표(?:원장)?[:\s]+([가-힣]{2,4})/);
    if (match) return match[1];
  }
  return null;
}

function determineClinicAgeGroup(hiraOpenedAt: string | null): string {
  if (!hiraOpenedAt) return 'established'; // 기본값
  const opened = new Date(hiraOpenedAt);
  const now = new Date();
  const yearsDiff = (now.getTime() - opened.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  if (yearsDiff <= 3) return 'newbie';
  if (yearsDiff <= 10) return 'established';
  return 'legacy';
}

function determineDoctorType(
  isSpecialist: boolean,
  isFranchise: boolean
): string {
  if (isFranchise) return 'network';
  return isSpecialist ? 'specialist' : 'gp';
}

// ─── 메인 ─────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

  log.info('=== Step 2: 연락처 파싱 + 페르소나 분류 ===');

  // 대상 병원 로드
  let hospitalQuery = supabase
    .from('hospitals')
    .select('id, name, address, hira_specialist_count, hira_opened_at, hira_department')
    .eq('status', 'active')
    .eq('is_target', true);

  if (limit > 0) hospitalQuery = hospitalQuery.limit(limit);

  const { data: hospitals, error: hErr } = await hospitalQuery;
  if (hErr) throw new Error(`Failed to load hospitals: ${hErr.message}`);
  if (!hospitals || hospitals.length === 0) {
    log.warn('No target hospitals found');
    return;
  }

  log.info(`Processing ${hospitals.length} hospitals`);

  let contactsUpdated = 0;
  let personasCreated = 0;

  for (let i = 0; i < hospitals.length; i++) {
    const h = hospitals[i];

    // ── 2-A: 연락처 추출 ──
    const { data: pages } = await supabase
      .from('scv_crawl_pages')
      .select('markdown')
      .eq('hospital_id', h.id)
      .not('markdown', 'is', null);

    const markdowns = (pages ?? [])
      .map((p: { markdown: string | null }) => p.markdown ?? '')
      .filter((m: string) => m.length > 0);

    if (markdowns.length > 0) {
      const contacts = extractContacts(markdowns);

      if (contacts.email || contacts.phone || contacts.kakao) {
        const { error: cErr } = await supabase
          .from('hospitals')
          .update({
            contact_email: contacts.email,
            contact_phone: contacts.phone,
            contact_kakao: contacts.kakao,
          })
          .eq('id', h.id);

        if (!cErr) contactsUpdated++;
      }
    }

    // ── 2-B/C: 대표원장/페이닥터 분류 → sales_personas ──
    const { data: doctors } = await supabase
      .from('hospital_doctors')
      .select('id, hospital_id, name, title, specialty')
      .eq('hospital_id', h.id);

    const footerRepName = markdowns.length > 0
      ? extractFooterRepName(markdowns)
      : null;

    const classification = classifyDoctors(
      (doctors ?? []) as DoctorRow[],
      footerRepName
    );

    // 프랜차이즈 여부 확인 (scv_crawl_dna)
    const { data: dnaRows } = await supabase
      .from('scv_crawl_dna')
      .select('fingerprint')
      .eq('hospital_id', h.id)
      .limit(1);

    const isFranchise = dnaRows?.[0]?.fingerprint?.is_franchise === true;

    const doctorType = determineDoctorType(classification.isSpecialist, isFranchise);
    const clinicAgeGroup = determineClinicAgeGroup(h.hira_opened_at);

    // 심평원 교차검증 — data_confidence
    const hiraCount = h.hira_specialist_count ?? null;
    const scvCount = classification.specialistCountScv;
    let dataConfidence = 'medium';
    if (hiraCount !== null) {
      dataConfidence = hiraCount === scvCount ? 'high' : 'low';
    }

    const { error: pErr } = await supabase
      .from('sales_personas')
      .upsert(
        {
          hospital_id: h.id,
          doctor_type: doctorType,
          clinic_age_group: clinicAgeGroup,
          is_representative: classification.representativeCount > 0,
          specialist_count_scv: scvCount,
          specialist_count_hira: hiraCount,
          data_confidence: dataConfidence,
          pay_doctor_count: classification.payDoctorCount,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'hospital_id' }
      );

    if (!pErr) personasCreated++;

    if ((i + 1) % 100 === 0) {
      log.info(`Progress: ${i + 1}/${hospitals.length}`);
    }
  }

  log.info('=== Step 2 complete ===');
  log.info(`Contacts updated: ${contactsUpdated}`);
  log.info(`Personas created/updated: ${personasCreated}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
