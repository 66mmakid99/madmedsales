/**
 * TORR RF scoring_criteria DB 업데이트 (v3.3)
 *
 * torr_rf_scoring_rules_v1.0.json → products.scoring_criteria 반영
 *
 * 변경 내용:
 *   - 6-Angle 가중치 업데이트 (body 3배 상향, post_op 신규)
 *   - 83개 키워드 사전 통합
 *   - equipment_bonus_rules (장비 가산점 매트릭스 9개)
 *   - clinic_type_rules (병원 타입 프로파일 A-F)
 *   - combine_therapy_packages (복합시술 패키지 10개)
 *
 * 실행: npx tsx scripts/products/update-torr-scoring.ts
 * 옵션: --dry-run  (DB 업데이트 없이 결과만 출력)
 */

import { supabase } from '../utils/supabase.js';
import { T } from '../../apps/engine/src/lib/table-names.js';
import type {
  ScoringCriteriaV31,
  SalesAngle,
  SalesKeyword,
  EquipmentBonusRule,
  ClinicTypeRule,
  CombineTherapyPackage,
} from '@madmedsales/shared';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

// ─── 소스 JSON 로드 ──────────────────────────────────────

const JSON_PATH = path.resolve(
  __dirname,
  '../../docs/products/torr-rf/torr_rf_scoring_rules_v1.0.json'
);

interface RawScoringRules {
  meta: { version: string; source: string };
  scoring_angles: Record<string, { weight: number; description: string }>;
  equipment_scoring_matrix: Array<{
    equipment: string;
    aliases: string[];
    bonus_score: number;
    pitching_angle: string;
    mention_count?: number;
  }>;
  keyword_dictionary: Record<string, {
    theme: string;
    score_per_keyword: number;
    keywords: string[];
  }>;
  clinic_type_profiles: Array<{
    type: string;
    name: string;
    base_score: number;
    detection_rules: {
      specialty_contains?: string[];
      menu_contains_any?: string[];
      equipment_contains_any?: string[];
      equipment_count_gte?: number;
      location_contains_any?: string[];
      // JSON에 있지만 사용하지 않는 필드 (무시)
      expansion_direction?: string;
      equipment_ratio_low?: boolean;
      location_type?: string[];
      clinic_type_any?: string[];
    };
  }>;
  combine_therapy_packages: Array<{
    id: number;
    name: string;
    components: string[];
    target: string;
  }>;
}

// ─── 각도 → 키워드 테마 매핑 ─────────────────────────────
// 각 angle id에 어떤 keyword_dictionary 테마를 연결할지 정의
const ANGLE_KEYWORD_MAP: Record<string, string[]> = {
  bridge:   ['pain_free', 'face_detail'],
  post_op:  ['post_surgery'],
  post_tx:  ['face_detail', 'skin_combo'],
  mens:     ['vip_premium'],
  painless: ['event_quick'],
  body:     ['body'],
};

// 공통 키워드 (모든 각도에 추가)
const COMMON_KEYWORD_THEMES = ['cost_appeal'];

// ─── 변환 함수 ───────────────────────────────────────────

function buildSalesAngles(raw: RawScoringRules): SalesAngle[] {
  return Object.entries(raw.scoring_angles).map(([id, angleData]) => {
    const themesToInclude = [
      ...(ANGLE_KEYWORD_MAP[id] ?? []),
      ...COMMON_KEYWORD_THEMES,
    ];

    const keywords: SalesKeyword[] = [];

    for (const themeName of themesToInclude) {
      const theme = raw.keyword_dictionary[themeName];
      if (!theme) continue;

      for (const kw of theme.keywords) {
        keywords.push({
          term: kw,
          tier: theme.score_per_keyword >= 3 ? 'primary' : 'secondary',
          point: theme.score_per_keyword >= 3 ? 20 : 10,
        });
      }
    }

    // 중복 term 제거
    const seen = new Set<string>();
    const uniqueKeywords = keywords.filter((k) => {
      if (seen.has(k.term)) return false;
      seen.add(k.term);
      return true;
    });

    return {
      id,
      name: id,
      label: angleData.description,
      weight: angleData.weight,
      keywords: uniqueKeywords,
    } satisfies SalesAngle;
  });
}

function buildEquipmentBonusRules(raw: RawScoringRules): EquipmentBonusRule[] {
  return raw.equipment_scoring_matrix.map((item) => ({
    equipment: item.equipment,
    aliases: item.aliases,
    bonus_score: item.bonus_score,
    pitching_angle: item.pitching_angle,
  }));
}

function buildClinicTypeRules(raw: RawScoringRules): ClinicTypeRule[] {
  return raw.clinic_type_profiles.map((profile) => ({
    type: profile.type,
    name: profile.name,
    base_score: profile.base_score,
    detection_rules: {
      // 지원하는 필드만 포함, 나머지 무시
      ...(profile.detection_rules.specialty_contains?.length
        ? { specialty_contains: profile.detection_rules.specialty_contains }
        : {}),
      ...(profile.detection_rules.menu_contains_any?.length
        ? { menu_contains_any: profile.detection_rules.menu_contains_any }
        : {}),
      ...(profile.detection_rules.equipment_contains_any?.length
        ? { equipment_contains_any: profile.detection_rules.equipment_contains_any }
        : {}),
      ...(profile.detection_rules.equipment_count_gte !== undefined
        ? { equipment_count_gte: profile.detection_rules.equipment_count_gte }
        : {}),
      ...(profile.detection_rules.location_contains_any?.length
        ? { location_contains_any: profile.detection_rules.location_contains_any }
        : {}),
    },
  }));
}

function buildCombineTherapyPackages(raw: RawScoringRules): CombineTherapyPackage[] {
  return raw.combine_therapy_packages.map((pkg) => ({
    package_name: pkg.name,
    required_equipment: pkg.components,
    pitch: pkg.target,
  }));
}

// ─── 기존 criteria 보존 필드 ─────────────────────────────
// combo_suggestions, exclude_if, sales_signals은 기존 DB 값 유지

// ─── 메인 ────────────────────────────────────────────────

async function run(): Promise<void> {
  console.log('=== TORR RF Scoring Update v3.3 ===');
  if (DRY_RUN) console.log('[DRY RUN] DB 업데이트 없이 미리보기만 출력\n');

  // 1. JSON 로드
  if (!fs.existsSync(JSON_PATH)) {
    console.error(`파일 없음: ${JSON_PATH}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf-8')) as RawScoringRules;
  console.log(`소스: ${raw.meta.source} (v${raw.meta.version})\n`);

  // 2. 기존 제품 조회
  const { data: product, error: fetchErr } = await supabase
    .from(T.products)
    .select('id, name, scoring_criteria')
    .eq('code', 'torr-rf')
    .single();

  if (fetchErr || !product) {
    console.error('TORR RF 제품을 찾을 수 없습니다. (code: torr-rf)');
    console.error(fetchErr?.message);
    process.exit(1);
  }

  console.log(`제품 확인: ${product.name} (id: ${product.id})`);

  // 3. 기존 criteria 로드 (보존 필드 유지)
  const existingCriteria = (product.scoring_criteria ?? {}) as Partial<ScoringCriteriaV31>;

  // 4. 변환
  const newSalesAngles = buildSalesAngles(raw);
  const equipmentBonusRules = buildEquipmentBonusRules(raw);
  const clinicTypeRules = buildClinicTypeRules(raw);
  const combineTherapyPackages = buildCombineTherapyPackages(raw);

  // 5. 미리보기 출력
  console.log('\n[6-Angle 업데이트]');
  for (const angle of newSalesAngles) {
    const kwCount = (angle.keywords as SalesKeyword[]).length;
    console.log(`  ${angle.id}: weight=${angle.weight}, keywords=${kwCount}개, label="${angle.label}"`);
  }
  const totalKeywords = newSalesAngles.reduce((s, a) => s + (a.keywords as SalesKeyword[]).length, 0);
  console.log(`  총 ${totalKeywords}개 키워드 (중복 포함 — 각도별 독립 목록)`);

  console.log('\n[Equipment Bonus Rules]');
  for (const rule of equipmentBonusRules) {
    console.log(`  ${rule.equipment}: +${rule.bonus_score}점`);
  }

  console.log('\n[Clinic Type Rules]');
  for (const rule of clinicTypeRules) {
    const conditions = Object.keys(rule.detection_rules).join(', ');
    console.log(`  Type ${rule.type} (${rule.name}): +${rule.base_score}점 [${conditions}]`);
  }

  console.log('\n[Combine Therapy Packages]');
  for (const pkg of combineTherapyPackages) {
    console.log(`  ${pkg.package_name}`);
  }

  // 6. 새 criteria 구성
  const newCriteria: ScoringCriteriaV31 = {
    // 기존 보존 필드
    combo_suggestions: existingCriteria.combo_suggestions ?? [],
    max_pitch_points: existingCriteria.max_pitch_points ?? 2,
    exclude_if: existingCriteria.exclude_if ?? ['has_torr_rf'],
    sales_signals: existingCriteria.sales_signals,
    // 업데이트 필드
    sales_angles: newSalesAngles,
    equipment_bonus_rules: equipmentBonusRules,
    clinic_type_rules: clinicTypeRules,
    combine_therapy_packages: combineTherapyPackages,
  };

  if (DRY_RUN) {
    console.log('\n[DRY RUN] 업데이트될 scoring_criteria (JSON 미리보기):');
    console.log(JSON.stringify(newCriteria, null, 2).slice(0, 2000) + '\n...(truncated)');
    console.log('\n[DRY RUN] 완료. --dry-run 플래그 제거 후 재실행하면 DB에 반영됩니다.');
    return;
  }

  // 7. DB 업데이트
  const { error: updateErr } = await supabase
    .from(T.products)
    .update({ scoring_criteria: newCriteria, updated_at: new Date().toISOString() })
    .eq('id', product.id);

  if (updateErr) {
    console.error('업데이트 실패:', updateErr.message);
    process.exit(1);
  }

  console.log('\n✅ DB 업데이트 완료!');
  console.log(`  - 6-Angle: ${newSalesAngles.length}개`);
  console.log(`  - Equipment Bonus Rules: ${equipmentBonusRules.length}개`);
  console.log(`  - Clinic Type Rules: ${clinicTypeRules.length}개`);
  console.log(`  - Combine Therapy Packages: ${combineTherapyPackages.length}개`);
  console.log('\n다음 단계: POST /api/scoring/match 로 스코어링 재실행 테스트');
}

run().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
