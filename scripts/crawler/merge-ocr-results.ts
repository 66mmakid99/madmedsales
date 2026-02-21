/**
 * Merge screenshot-OCR results into text-based analysis results.
 * Deduplicates by equipment/treatment name (case-insensitive).
 * OCR prices take precedence over text-based prices.
 */
import type { WebAnalysisResult } from '../analysis/analyze-web.js';
import type { OcrEquipment, OcrTreatment } from './screenshot-ocr.js';

export interface MergeStats {
  newEquipments: number;
  newTreatments: number;
  updatedPrices: number;
  updatedManufacturers: number;
}

export function mergeScreenshotOcr(
  textAnalysis: WebAnalysisResult,
  ocrEquipments: OcrEquipment[],
  ocrTreatments: OcrTreatment[]
): { result: WebAnalysisResult; stats: MergeStats } {
  const stats: MergeStats = {
    newEquipments: 0,
    newTreatments: 0,
    updatedPrices: 0,
    updatedManufacturers: 0,
  };

  // Index existing equipment by name (lowercase)
  const eqIndex = new Map(
    textAnalysis.equipments.map((e) => [e.equipment_name.toLowerCase().trim(), e])
  );

  for (const ocrEq of ocrEquipments) {
    const key = ocrEq.equipment_name.toLowerCase().trim();
    if (!key) continue;

    const existing = eqIndex.get(key);
    if (existing) {
      // Update manufacturer if OCR found one and text didn't
      if (ocrEq.manufacturer && !existing.manufacturer) {
        existing.manufacturer = ocrEq.manufacturer;
        stats.updatedManufacturers++;
      }
    } else {
      // Brand new equipment from OCR
      eqIndex.set(key, {
        equipment_name: ocrEq.equipment_name,
        equipment_brand: null,
        equipment_category: ocrEq.equipment_category,
        equipment_model: null,
        estimated_year: null,
        manufacturer: ocrEq.manufacturer,
      });
      textAnalysis.equipments.push(eqIndex.get(key)!);
      stats.newEquipments++;
    }
  }

  // Index existing treatments by name (lowercase)
  const trIndex = new Map(
    textAnalysis.treatments.map((t) => [t.treatment_name.toLowerCase().trim(), t])
  );

  for (const ocrTr of ocrTreatments) {
    const key = ocrTr.treatment_name.toLowerCase().trim();
    if (!key) continue;

    const existing = trIndex.get(key);
    if (existing) {
      // OCR prices take precedence (more accurate from visual content)
      if (ocrTr.price != null && existing.price == null) {
        existing.price = ocrTr.price;
        stats.updatedPrices++;
      }
      if (ocrTr.price_event != null && existing.price_event == null) {
        existing.price_event = ocrTr.price_event;
        stats.updatedPrices++;
      }
    } else {
      // Brand new treatment from OCR
      trIndex.set(key, {
        treatment_name: ocrTr.treatment_name,
        treatment_category: ocrTr.treatment_category,
        original_name: null,
        price: ocrTr.price,
        price_event: ocrTr.price_event,
        price_min: null,
        price_max: null,
        is_promoted: false,
      });
      textAnalysis.treatments.push(trIndex.get(key)!);
      stats.newTreatments++;
    }
  }

  return { result: textAnalysis, stats };
}
