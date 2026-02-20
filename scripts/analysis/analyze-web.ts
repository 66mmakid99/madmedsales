/**
 * Gemini Flash 웹 분석
 * 병원 웹사이트 텍스트를 Gemini Flash API로 분석하여
 * 장비 및 시술 정보를 구조화합니다.
 */
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { delay } from '../utils/delay.js';
import { createLogger } from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const log = createLogger('analyze-web');

const GOOGLE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
if (!GOOGLE_AI_API_KEY) {
  throw new Error('Missing GOOGLE_AI_API_KEY in scripts/.env');
}

const WEB_RAW_DIR = path.resolve(__dirname, '../data/web-raw');
const DELAY_MS = 1000;

// v1.0 - 2026-02-20
const ANALYSIS_PROMPT = `당신은 한국 미용 의료 시장 전문가입니다.
이 병원 홈페이지 내용을 분석하여 다음 정보를 추출하세요.

[추출할 정보]
1. 보유 장비 목록
   - equipment_name: 장비명 (예: 울쎄라, 써마지, 인모드, 피코레이저)
   - equipment_brand: 브랜드/제조사
   - equipment_category: rf | laser | ultrasound | ipl | other
   - equipment_model: 모델명 (알 수 있는 경우)
   - estimated_year: 추정 도입년도 (알 수 있는 경우)

2. 시술 메뉴
   - treatment_name: 시술명
   - treatment_category: lifting | tightening | toning | filler | botox | laser_toning | scar | acne | whitening | other
   - price_min: 최소 가격 (원, 알 수 있는 경우)
   - price_max: 최대 가격 (원, 알 수 있는 경우)
   - is_promoted: 메인에 노출되거나 강조된 시술인지 (true/false)

3. 병원 특성
   - main_focus: 주력 분야 (예: "리프팅 전문", "여드름/흉터", "종합 피부")
   - target_audience: 주요 타깃 환자층 추정

[규칙]
- 확실하지 않은 정보는 null로 표시
- 장비명은 한국에서 통용되는 이름 사용
- JSON 형식으로만 응답 (설명 텍스트 없이)

[홈페이지 내용]
`;

interface AnalysisEquipment {
  equipment_name: string;
  equipment_brand: string | null;
  equipment_category: string;
  equipment_model: string | null;
  estimated_year: number | null;
}

interface AnalysisTreatment {
  treatment_name: string;
  treatment_category: string;
  price_min: number | null;
  price_max: number | null;
  is_promoted: boolean;
}

interface WebAnalysisResult {
  equipments: AnalysisEquipment[];
  treatments: AnalysisTreatment[];
  hospital_profile: {
    main_focus: string;
    target_audience: string;
  };
}

interface WebRawData {
  hospitalId: string;
  success: boolean;
  text?: string;
  email?: string | null;
}

async function analyzeWithGemini(text: string): Promise<WebAnalysisResult | null> {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`,
      {
        contents: [
          {
            parts: [{ text: ANALYSIS_PROMPT + text }],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
        },
      },
      { timeout: 30000 }
    );

    const candidates = response.data?.candidates;
    if (!candidates || candidates.length === 0) {
      log.warn('No candidates in Gemini response');
      return null;
    }

    const content = candidates[0]?.content?.parts?.[0]?.text;
    if (!content) {
      log.warn('No text content in Gemini response');
      return null;
    }

    const parsed: unknown = JSON.parse(content);
    if (!isValidAnalysisResult(parsed)) {
      log.warn('Invalid analysis result structure');
      return null;
    }

    return parsed;
  } catch (err) {
    log.error('Gemini API call failed', err);
    return null;
  }
}

function isValidAnalysisResult(data: unknown): data is WebAnalysisResult {
  if (typeof data !== 'object' || data === null) return false;
  const obj = data as Record<string, unknown>;
  return Array.isArray(obj.equipments) && Array.isArray(obj.treatments);
}

async function main(): Promise<void> {
  log.info('Starting web content analysis');

  const files = await fs.readdir(WEB_RAW_DIR);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  log.info(`Found ${jsonFiles.length} web-raw files to analyze`);

  let processed = 0;
  let analyzed = 0;

  for (const file of jsonFiles) {
    processed++;
    const filePath = path.join(WEB_RAW_DIR, file);
    const raw = await fs.readFile(filePath, 'utf-8');
    const data: WebRawData = JSON.parse(raw);

    if (!data.success || !data.text || data.text.length < 100) {
      continue;
    }

    // Check if already analyzed (has analysis key)
    if ('analysis' in data) {
      continue;
    }

    log.info(
      `[${processed}/${jsonFiles.length}] Analyzing: ${data.hospitalId}`
    );

    const analysis = await analyzeWithGemini(data.text);

    if (analysis) {
      // Merge analysis back into the file
      const enriched = { ...data, analysis };
      await fs.writeFile(filePath, JSON.stringify(enriched, null, 2), 'utf-8');
      analyzed++;

      log.info(
        `Analyzed ${data.hospitalId}: ${analysis.equipments.length} equipments, ${analysis.treatments.length} treatments`
      );
    }

    await delay(DELAY_MS);
  }

  log.info(`Analysis complete. Processed: ${processed}, Analyzed: ${analyzed}`);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
