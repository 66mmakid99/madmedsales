/**
 * Gemini Flash 웹 분석 v4.0
 * 병원 웹사이트 텍스트를 Gemini Flash API로 분석하여
 * 장비, 시술, 의료진 정보를 구조화합니다.
 */
import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { delay } from '../utils/delay.js';
import { createLogger } from '../utils/logger.js';
import { logApiUsage } from '../utils/usage-logger.js';
import { getAccessToken } from './gemini-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const log = createLogger('analyze-web');

const WEB_RAW_DIR = path.resolve(__dirname, '../data/web-raw');
const DELAY_MS = 1000;

// v4.0 - 2026-02-20 - doctors, expanded categories, price, compound names
const ANALYSIS_PROMPT = `당신은 한국 미용 의료 시장 전문가입니다.
병원 홈페이지 내용을 분석하여 아래 JSON으로 추출하세요.

{
  "doctors": [{"name":"","title":"","specialty":"","career":[]}],
  "equipments": [{"equipment_name":"","equipment_category":"rf|hifu|laser|booster|body|lifting|other","manufacturer":""}],
  "treatments": [{"treatment_name":"","original_name":null,"treatment_category":"","price":null,"price_event":null,"is_promoted":false}],
  "hospital_profile": {"main_focus":"","target_audience":""},
  "contact_info": {"emails":[],"phones":[],"contact_page_url":null}
}

장비 참고 리스트:
- rf: 인모드, 써마지, 올리지오, 포텐자, 시크릿, 스카젠, 테너, 빈센자, TORR
- hifu: 울쎄라, 슈링크, 리프테라, 더블로
- laser: 피코슈어, 피코웨이, 레블라이트, 클라리티, 엑셀V, 젠틀맥스, 프락셀
- booster: 리쥬란, 쥬베룩, 물광, 연어주사
- body: 쿨스컬프팅, 바넥스, 리포셀
- lifting: 실리프팅, 민트실, PDO, 울핏

합성어 시술명 매핑 (original_name):
- 브랜딩 시술명 → 원래 시술/장비 추출
- 예: "프리미엄 V라인 리프팅" → "울쎄라+실리프팅"
- 합성어가 아니면 null

규칙:
- 가격은 KRW 정수 ("15만원" → 150000)
- price=정상가, price_event=이벤트/할인가
- 의료진: 이름, 직함(대표원장/원장/부원장), 전문분야(피부과전문의 등), 주요경력
- manufacturer=장비 제조사 (알 수 있는 경우만)
- 확실하지 않은 값은 null
- JSON만 응답 (설명 없이)

홈페이지 내용:
`;

// --- Interfaces ---

export interface AnalysisDoctor {
  name: string;
  title: string | null;
  specialty: string | null;
  career: string[];
}

export interface AnalysisEquipment {
  equipment_name: string;
  equipment_brand: string | null;
  equipment_category: string;
  equipment_model: string | null;
  estimated_year: number | null;
  manufacturer: string | null;
}

export interface AnalysisTreatment {
  treatment_name: string;
  treatment_category: string;
  original_name: string | null;
  price: number | null;
  price_event: number | null;
  price_min: number | null;
  price_max: number | null;
  is_promoted: boolean;
}

interface ContactInfo {
  emails: string[];
  phones: string[];
  contact_page_url: string | null;
}

export interface WebAnalysisResult {
  doctors: AnalysisDoctor[];
  equipments: AnalysisEquipment[];
  treatments: AnalysisTreatment[];
  hospital_profile: {
    main_focus: string;
    target_audience: string;
  };
  contact_info?: ContactInfo;
}

interface WebRawData {
  hospitalId: string;
  success: boolean;
  text?: string;
  email?: string | null;
}

// Token usage tracking
let totalInputTokens = 0;
let totalOutputTokens = 0;
let totalApiCalls = 0;

export async function analyzeWithGemini(
  text: string,
  hospitalId?: string
): Promise<WebAnalysisResult | null> {
  try {
    const token = await getAccessToken();
    const response = await axios.post(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        contents: [{ parts: [{ text: ANALYSIS_PROMPT + text }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 4000,
          responseMimeType: 'application/json',
        },
      },
      { timeout: 60000, headers: { Authorization: `Bearer ${token}` } }
    );

    const usageMetadata = response.data?.usageMetadata;
    if (usageMetadata) {
      const inputTokens = usageMetadata.promptTokenCount ?? 0;
      const outputTokens = usageMetadata.candidatesTokenCount ?? 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
      totalApiCalls++;

      log.info(`Tokens: in=${inputTokens} out=${outputTokens} (cumulative: in=${totalInputTokens} out=${totalOutputTokens})`);

      await logApiUsage({
        service: 'gemini',
        model: 'gemini-2.0-flash',
        purpose: 'web_analysis',
        inputTokens,
        outputTokens,
        hospitalId,
      });
    }

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
    return normalizeResult(parsed);
  } catch (err) {
    log.error('Gemini API call failed', err);
    return null;
  }
}

function normalizeResult(data: unknown): WebAnalysisResult | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  const doctors = (obj.doctors ?? obj.doctor ?? []) as AnalysisDoctor[];
  const equipments = (obj.equipments ?? obj.equipment ?? []) as AnalysisEquipment[];
  const treatments = (obj.treatments ?? obj.treatment ?? []) as AnalysisTreatment[];

  if (!Array.isArray(equipments) || !Array.isArray(treatments)) return null;

  const profile = (obj.hospital_profile ?? obj.clinic_characteristics ?? {}) as Record<string, string>;
  const contact = (obj.contact_info ?? obj.contact_information ?? {}) as Record<string, unknown>;

  return {
    doctors: Array.isArray(doctors) ? doctors : [],
    equipments,
    treatments,
    hospital_profile: {
      main_focus: profile.main_focus ?? '',
      target_audience: profile.target_audience ?? '',
    },
    contact_info: {
      emails: Array.isArray(contact.emails) ? contact.emails as string[] : [],
      phones: Array.isArray(contact.phones) ? contact.phones as string[] : [],
      contact_page_url: (contact.contact_page_url as string) ?? null,
    },
  };
}

async function main(): Promise<void> {
  log.info('Starting web content analysis (v4.0)');

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

    if (!data.success || !data.text || data.text.length < 100) continue;
    if ('analysis' in data) continue;

    log.info(`[${processed}/${jsonFiles.length}] Analyzing: ${data.hospitalId}`);

    const analysis = await analyzeWithGemini(data.text, data.hospitalId);

    if (analysis) {
      const enriched = { ...data, analysis };
      await fs.writeFile(filePath, JSON.stringify(enriched, null, 2), 'utf-8');
      analyzed++;

      log.info(
        `Analyzed ${data.hospitalId}: ${analysis.doctors.length} doctors, ${analysis.equipments.length} equipments, ${analysis.treatments.length} treatments`
      );
    }

    await delay(DELAY_MS);
  }

  const costPerMInput = 0.10;
  const costPerMOutput = 0.40;
  const estimatedCost = (totalInputTokens / 1_000_000) * costPerMInput + (totalOutputTokens / 1_000_000) * costPerMOutput;
  log.info(`Analysis complete. Processed: ${processed}, Analyzed: ${analyzed}`);
  log.info(`Token usage: ${totalApiCalls} calls, input=${totalInputTokens}, output=${totalOutputTokens}`);
  log.info(`Estimated cost: $${estimatedCost.toFixed(4)} (₩${Math.round(estimatedCost * 1450).toLocaleString()})`);
}

// Only run main when executed directly (not when imported)
const isDirectRun = process.argv[1]?.includes('analyze-web');
if (isDirectRun) {
  main().catch((err) => {
    log.error('Fatal error', err);
    process.exit(1);
  });
}
