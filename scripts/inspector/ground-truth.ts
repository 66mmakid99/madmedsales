/**
 * Data QA Inspector v2 — Ground Truth 검증 시스템
 *
 * 1. 수동 검증 정답지 (JSON) 로드
 * 2. Inspector 판정 결과와 비교
 * 3. KPI 산출 (Recall, Precision, 재추출 개선율)
 *
 * 실행: npx tsx scripts/inspector/ground-truth.ts
 *
 * 정답지 파일: scripts/inspector/ground-truth-data.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { supabase } from '../utils/supabase.js';
import type { InspectorGrade } from './types';

// ============================================================
// Ground Truth 데이터 구조
// ============================================================
interface GroundTruthEntry {
  hospital_id: string;
  hospital_name: string;
  hospital_type_actual: 'small' | 'medium' | 'large';
  // 수동 검증 결과
  actual_equipment_count: number;
  actual_treatment_count: number;
  actual_doctor_count: number;
  has_price_info: boolean;
  actual_quality: 'good' | 'partial' | 'bad' | 'no_data';
  // good = S급 (모든 정보 정확), partial = A급, bad = F급, no_data = X급
  notes?: string;
}

type ActualQuality = GroundTruthEntry['actual_quality'];

const QUALITY_TO_GRADE: Record<ActualQuality, InspectorGrade> = {
  good: 'S',
  partial: 'A',
  bad: 'F',
  no_data: 'X',
};

// ============================================================
// KPI 계산
// ============================================================
interface KPIResult {
  recall_xf: number;       // 실제 불량(bad/no_data) 중 Inspector가 X/F로 잡아낸 비율
  precision_s: number;     // Inspector S판정 중 실제로 good인 비율
  a_to_s_rate: number;     // A등급 중 실제 S급인 비율
  total_samples: number;
  confusion: {
    tp_xf: number;  // true positive: 실제 불량 + Inspector 불량
    fn_xf: number;  // false negative: 실제 불량 + Inspector 양호
    tp_s: number;   // Inspector S + 실제 good
    fp_s: number;   // Inspector S + 실제 not good
  };
  details: Array<{
    hospital: string;
    actual: ActualQuality;
    inspector_grade: InspectorGrade;
    inspector_score: number;
    match: boolean;
  }>;
}

function computeKPI(
  groundTruth: GroundTruthEntry[],
  inspectorResults: Map<string, { grade: InspectorGrade; score: number }>,
): KPIResult {
  const details: KPIResult['details'] = [];

  let tp_xf = 0, fn_xf = 0, tp_s = 0, fp_s = 0;
  let a_actual_s = 0, a_total = 0;

  for (const gt of groundTruth) {
    const inspector = inspectorResults.get(gt.hospital_id);
    if (!inspector) {
      details.push({
        hospital: gt.hospital_name,
        actual: gt.actual_quality,
        inspector_grade: 'X' as InspectorGrade,
        inspector_score: 0,
        match: false,
      });
      continue;
    }

    const actualGrade = QUALITY_TO_GRADE[gt.actual_quality];
    const isBad = gt.actual_quality === 'bad' || gt.actual_quality === 'no_data';
    const inspectorBad = inspector.grade === 'F' || inspector.grade === 'X';

    // Recall(X/F): 실제 불량 → Inspector도 불량?
    if (isBad && inspectorBad) tp_xf++;
    if (isBad && !inspectorBad) fn_xf++;

    // Precision(S): Inspector S → 실제 good?
    if (inspector.grade === 'S' && gt.actual_quality === 'good') tp_s++;
    if (inspector.grade === 'S' && gt.actual_quality !== 'good') fp_s++;

    // A→S 승격율
    if (inspector.grade === 'A') {
      a_total++;
      if (gt.actual_quality === 'good') a_actual_s++;
    }

    details.push({
      hospital: gt.hospital_name,
      actual: gt.actual_quality,
      inspector_grade: inspector.grade,
      inspector_score: inspector.score,
      match: actualGrade === inspector.grade,
    });
  }

  return {
    recall_xf: (tp_xf + fn_xf) > 0 ? tp_xf / (tp_xf + fn_xf) : 1,
    precision_s: (tp_s + fp_s) > 0 ? tp_s / (tp_s + fp_s) : 1,
    a_to_s_rate: a_total > 0 ? a_actual_s / a_total : 0,
    total_samples: groundTruth.length,
    confusion: { tp_xf, fn_xf, tp_s, fp_s },
    details,
  };
}

// ============================================================
// 메인
// ============================================================
async function main(): Promise<void> {
  const gtPath = path.resolve(__dirname, 'ground-truth-data.json');

  if (!fs.existsSync(gtPath)) {
    console.log('Ground Truth 정답지 없음. 템플릿을 생성합니다.');
    generateTemplate(gtPath);
    return;
  }

  const groundTruth: GroundTruthEntry[] = JSON.parse(fs.readFileSync(gtPath, 'utf-8'));
  console.log(`Ground Truth: ${groundTruth.length}개 병원 로드됨`);

  // Inspector 결과 조회
  const hospitalIds = groundTruth.map(g => g.hospital_id);
  const { data, error } = await supabase
    .from('scv_crawl_validations')
    .select('hospital_id, inspector_grade, confidence_score')
    .in('hospital_id', hospitalIds)
    .not('inspector_grade', 'is', null);

  if (error) {
    console.error(`DB 조회 실패: ${error.message}`);
    return;
  }

  const inspectorMap = new Map<string, { grade: InspectorGrade; score: number }>();
  for (const row of (data || [])) {
    inspectorMap.set(row.hospital_id, {
      grade: row.inspector_grade as InspectorGrade,
      score: row.confidence_score || 0,
    });
  }

  console.log(`Inspector 결과: ${inspectorMap.size}개 매칭\n`);

  // KPI 계산
  const kpi = computeKPI(groundTruth, inspectorMap);

  // 결과 출력
  console.log('=== Ground Truth KPI ===');
  console.log(`Recall (X/F):    ${(kpi.recall_xf * 100).toFixed(1)}% (목표 >= 90%)`);
  console.log(`Precision (S):   ${(kpi.precision_s * 100).toFixed(1)}% (목표 >= 85%)`);
  console.log(`A->S 승격율:     ${(kpi.a_to_s_rate * 100).toFixed(1)}%`);
  console.log(`총 샘플:         ${kpi.total_samples}개`);
  console.log(`\nConfusion Matrix:`);
  console.log(`  실제 불량 → Inspector 불량(TP): ${kpi.confusion.tp_xf}`);
  console.log(`  실제 불량 → Inspector 양호(FN): ${kpi.confusion.fn_xf}`);
  console.log(`  Inspector S → 실제 good(TP):    ${kpi.confusion.tp_s}`);
  console.log(`  Inspector S → 실제 not good(FP): ${kpi.confusion.fp_s}`);

  console.log('\n=== 병원별 상세 ===');
  for (const d of kpi.details) {
    const icon = d.match ? 'O' : 'X';
    console.log(`  [${icon}] ${d.hospital} — 실제:${d.actual} → Inspector:${d.inspector_grade}(${d.inspector_score}점)`);
  }

  // 결과 저장
  const resultPath = path.resolve(__dirname, '..', '..', 'output', 'ground-truth-kpi.json');
  fs.writeFileSync(resultPath, JSON.stringify(kpi, null, 2));
  console.log(`\nKPI 결과 저장: ${resultPath}`);
}

function generateTemplate(gtPath: string): void {
  const template: GroundTruthEntry[] = [
    {
      hospital_id: 'REPLACE_WITH_UUID',
      hospital_name: '(병원명)',
      hospital_type_actual: 'medium',
      actual_equipment_count: 0,
      actual_treatment_count: 0,
      actual_doctor_count: 0,
      has_price_info: false,
      actual_quality: 'good',
      notes: '수동 검증 메모',
    },
  ];

  fs.writeFileSync(gtPath, JSON.stringify(template, null, 2));
  console.log(`템플릿 생성: ${gtPath}`);
  console.log('20개 병원 정보를 채운 후 다시 실행하세요.');
}

main().catch(console.error);
