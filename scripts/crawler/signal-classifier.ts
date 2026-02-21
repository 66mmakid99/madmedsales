/**
 * 시그널 분류 모듈
 * - equipment_changes의 변동 내역을 product.scoring_criteria.sales_signals 규칙과 매칭
 * - 매칭 시 sales_signals 테이블에 INSERT
 *
 * v1.0 - 2026-02-21
 */
import { supabase } from '../utils/supabase.js';
import type { EquipmentChange } from './change-detector.js';
import type { SalesSignalRule } from '@madmedsales/shared';

export interface ClassifiedSignal {
  hospital_id: string;
  product_id: string;
  signal_type: string;
  priority: string;
  title: string;
  description: string;
  related_angle: string;
  source_change_id: string | null;
  status: string;
  detected_at: string;
}

/**
 * trigger → change_type 매핑
 */
function triggerToChangeType(trigger: string): { changeType: string; itemType: string } | null {
  switch (trigger) {
    case 'equipment_removed': return { changeType: 'REMOVED', itemType: 'EQUIPMENT' };
    case 'equipment_added': return { changeType: 'ADDED', itemType: 'EQUIPMENT' };
    case 'treatment_added': return { changeType: 'ADDED', itemType: 'TREATMENT' };
    case 'treatment_removed': return { changeType: 'REMOVED', itemType: 'TREATMENT' };
    default: return null;
  }
}

/**
 * 키워드 매칭: 공백 제거 + Contains (matcher.ts 동일 로직)
 */
function matchesKeyword(keyword: string, text: string): boolean {
  const normalizedKw = keyword.replace(/\s+/g, '').toLowerCase();
  const normalizedText = text.replace(/\s+/g, '').toLowerCase();
  return normalizedText.includes(normalizedKw);
}

/**
 * 변동 목록에서 제품별 시그널을 분류하고 sales_signals에 INSERT.
 *
 * @param changes - detectEquipmentChanges()의 결과
 * @param productId - 대상 제품 ID
 * @param salesSignalRules - product.scoring_criteria.sales_signals 규칙 배열
 */
export async function classifySignals(
  changes: EquipmentChange[],
  productId: string,
  salesSignalRules: SalesSignalRule[]
): Promise<ClassifiedSignal[]> {
  if (!salesSignalRules || salesSignalRules.length === 0) return [];
  if (changes.length === 0) return [];

  const signals: ClassifiedSignal[] = [];
  const now = new Date().toISOString();

  for (const rule of salesSignalRules) {
    const mapping = triggerToChangeType(rule.trigger);
    if (!mapping) continue;

    // 해당 trigger와 일치하는 변동 필터링
    const matchingChanges = changes.filter(
      (c) => c.change_type === mapping.changeType && c.item_type === mapping.itemType
    );

    for (const change of matchingChanges) {
      // 키워드 매칭
      const isKeywordMatch = rule.match_keywords.some(
        (kw) => matchesKeyword(kw, change.standard_name) || matchesKeyword(kw, change.item_name)
      );

      if (!isKeywordMatch) continue;

      // 템플릿 치환
      const title = rule.title_template.replace(/\{\{item_name\}\}/g, change.item_name);
      const description = rule.description_template.replace(/\{\{item_name\}\}/g, change.item_name);

      // signal_type 결정
      const signalType = `${change.item_type}_${change.change_type}`;

      signals.push({
        hospital_id: change.hospital_id,
        product_id: productId,
        signal_type: signalType,
        priority: rule.priority,
        title,
        description,
        related_angle: rule.related_angle,
        source_change_id: change.id ?? null,
        status: 'NEW',
        detected_at: now,
      });
    }
  }

  // DB INSERT (best-effort)
  if (signals.length > 0) {
    try {
      await supabase.from('sales_signals').insert(
        signals.map((s) => ({
          hospital_id: s.hospital_id,
          product_id: s.product_id,
          signal_type: s.signal_type,
          priority: s.priority,
          title: s.title,
          description: s.description,
          related_angle: s.related_angle,
          source_change_id: s.source_change_id,
          status: s.status,
          detected_at: s.detected_at,
        }))
      );
    } catch {
      // DB INSERT 실패 → skip (non-fatal)
    }
  }

  return signals;
}
