/**
 * Gemini Vision OCR for hospital images.
 * Analyzes price tables and equipment photos from hospital websites.
 */
import axios from 'axios';
import { createLogger } from '../utils/logger.js';
import { logApiUsage } from '../utils/usage-logger.js';
import { getAccessToken } from './gemini-auth.js';
import type { AnalysisEquipment, AnalysisTreatment, WebAnalysisResult } from './analyze-web.js';

const log = createLogger('analyze-images');

// v1.0 - 2026-02-20 - OCR for price tables and equipment images
const IMAGE_OCR_PROMPT = `이 이미지는 한국 피부과/성형외과 병원 홈페이지에서 가져온 것입니다.
이미지에서 다음을 추출하세요:

1. 가격표: 시술명, 정상가(price), 이벤트가(price_event)
2. 장비사진: 장비명, 제조사(manufacturer)

가격은 KRW 정수 (예: "15만원" → 150000)

JSON 응답:
{
  "equipments": [{"equipment_name":"","equipment_category":"rf|hifu|laser|booster|body|lifting|other","manufacturer":""}],
  "treatments": [{"treatment_name":"","treatment_category":"","price":null,"price_event":null}]
}

이미지에 해당 정보가 없으면 빈 배열.
JSON만 응답 (설명 없이)`;

interface OcrEquipment {
  equipment_name: string;
  equipment_category: string;
  manufacturer: string | null;
}

interface OcrTreatment {
  treatment_name: string;
  treatment_category: string;
  price: number | null;
  price_event: number | null;
}

interface OcrResult {
  equipments: OcrEquipment[];
  treatments: OcrTreatment[];
}

export interface ImageInput {
  base64: string;
  mimeType: string;
  url: string;
}

/** Analyze a single image with Gemini Vision */
export async function analyzeImage(
  image: ImageInput,
  hospitalId?: string
): Promise<OcrResult | null> {
  try {
    const token = await getAccessToken();
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        contents: [{
          parts: [
            { text: IMAGE_OCR_PROMPT },
            {
              inline_data: {
                mime_type: image.mimeType,
                data: image.base64,
              },
            },
          ],
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
        },
      },
      { timeout: 30000, headers: { Authorization: `Bearer ${token}` } }
    );

    const usageMetadata = response.data?.usageMetadata;
    if (usageMetadata) {
      const inputTokens = usageMetadata.promptTokenCount ?? 0;
      const outputTokens = usageMetadata.candidatesTokenCount ?? 0;

      log.info(`OCR tokens: in=${inputTokens} out=${outputTokens}`);

      await logApiUsage({
        service: 'gemini',
        model: 'gemini-2.0-flash',
        purpose: 'image_ocr',
        inputTokens,
        outputTokens,
        hospitalId,
      });
    }

    const content = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return null;

    const parsed = JSON.parse(content) as OcrResult;
    return {
      equipments: Array.isArray(parsed.equipments) ? parsed.equipments : [],
      treatments: Array.isArray(parsed.treatments) ? parsed.treatments : [],
    };
  } catch (err) {
    log.warn(`Image OCR failed for ${image.url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Analyze multiple images and merge results */
export async function analyzeAllImages(
  images: ImageInput[],
  hospitalId?: string
): Promise<OcrResult> {
  const merged: OcrResult = { equipments: [], treatments: [] };

  for (const img of images) {
    const result = await analyzeImage(img, hospitalId);
    if (!result) continue;

    merged.equipments.push(...result.equipments);
    merged.treatments.push(...result.treatments);
  }

  return merged;
}

/** Merge OCR results into text-based analysis, deduplicating by name */
export function mergeOcrIntoAnalysis(
  textAnalysis: WebAnalysisResult,
  ocrResults: OcrResult
): WebAnalysisResult {
  const existingEqNames = new Set(
    textAnalysis.equipments.map((e) => e.equipment_name.toLowerCase())
  );
  const existingTrNames = new Set(
    textAnalysis.treatments.map((t) => t.treatment_name.toLowerCase())
  );

  // Add new equipments from OCR
  for (const eq of ocrResults.equipments) {
    if (existingEqNames.has(eq.equipment_name.toLowerCase())) {
      // Update manufacturer if text analysis didn't have it
      const existing = textAnalysis.equipments.find(
        (e) => e.equipment_name.toLowerCase() === eq.equipment_name.toLowerCase()
      );
      if (existing && !existing.manufacturer && eq.manufacturer) {
        existing.manufacturer = eq.manufacturer;
      }
      continue;
    }

    existingEqNames.add(eq.equipment_name.toLowerCase());
    textAnalysis.equipments.push({
      equipment_name: eq.equipment_name,
      equipment_brand: null,
      equipment_category: eq.equipment_category,
      equipment_model: null,
      estimated_year: null,
      manufacturer: eq.manufacturer,
    });
  }

  // Add new treatments from OCR, or update prices (OCR price > text price)
  for (const tr of ocrResults.treatments) {
    const existing = textAnalysis.treatments.find(
      (t) => t.treatment_name.toLowerCase() === tr.treatment_name.toLowerCase()
    );

    if (existing) {
      // OCR price takes precedence (more accurate from price table images)
      if (tr.price != null) existing.price = tr.price;
      if (tr.price_event != null) existing.price_event = tr.price_event;
      continue;
    }

    if (existingTrNames.has(tr.treatment_name.toLowerCase())) continue;

    existingTrNames.add(tr.treatment_name.toLowerCase());
    textAnalysis.treatments.push({
      treatment_name: tr.treatment_name,
      treatment_category: tr.treatment_category,
      original_name: null,
      price: tr.price,
      price_event: tr.price_event,
      price_min: null,
      price_max: null,
      is_promoted: false,
    });
  }

  return textAnalysis;
}
