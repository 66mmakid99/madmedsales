/**
 * v5.4 타입 정의
 * - v5.4: 2-step 파이프라인 + 6-category 확장
 */

// ============================================================
// v5.4 확장 타입 (6-category)
// ============================================================
export interface DoctorV54 {
  name: string;
  title: string;
  specialty?: string | null;
  education?: string | string[] | null;
  career?: string | string[] | null;
  certifications?: string[] | null;
  academic_activity?: string | null;
  confidence?: 'confirmed' | 'uncertain';
  name_source?: 'web_verified' | 'web_corrected' | 'ocr_only' | 'ocr_confirmed';
  notes?: string | null;
}

export interface AcademicActivity {
  type: string;   // 논문 | 학회발표 | 교과서집필 | 임상연구 | 수상 | 기타
  title: string;
  year?: string | null;
  doctor_name?: string | null;
  source_text?: string | null;
}

export interface EquipmentV54 {
  name: string;
  brand?: string | null;
  model?: string | null;
  korean_name?: string | null;
  category: string;
  description?: string | null;
  manufacturer?: string | null;
  source?: 'text' | 'image_banner' | 'image_page' | null;
}

/** v5.4 작업 4: 의료기기 통합 분류 (device + injectable) */
export interface MedicalDeviceV54 {
  name: string;
  korean_name?: string | null;
  manufacturer?: string | null;
  device_type: 'device' | 'injectable';
  subcategory: string;           // RF, HIFU, laser, filler, botox, booster, lipolytic, collagen_stimulator, thread, ...
  description?: string | null;
  source?: 'text' | 'image_banner' | 'image_page' | 'ocr' | null;
}

export interface DeviceDictionaryEntry {
  name: string;
  aliases: string[];
  device_type: 'device' | 'injectable';
  subcategory: string;
  manufacturer?: string | null;
  torr_relation?: string | null;
}

export interface TreatmentV54 {
  name: string;
  category: string;
  price?: number | null;
  price_display?: string | null;
  price_note?: string | null;
  is_promoted?: boolean;
  is_package?: boolean;
  package_detail?: {
    included_treatments?: string[];
    estimated_unit_prices?: (number | null)[];
    estimation_method?: string;
  } | null;
  session_info?: string | null;
  body_part?: string | null;
  combo_with?: string | null;
}

export interface EventV54 {
  title: string;
  type?: string | null;
  period?: string | null;
  description?: string | null;
  discount_info?: string | null;
  discount_type?: string | null;
  discount_value?: string | null;
  original_price?: number | null;
  event_price?: number | null;
  conditions?: string[] | null;
  source?: 'text' | 'popup' | 'banner' | 'page' | null;
  related_treatments?: string[];
}

export interface ClinicCategory {
  name: string;
  treatments: string[];
}

export interface ContactEmail {
  address: string;
  type: '대표' | '상담' | '채용' | '기타';
  source?: string | null;
}

export interface ContactPhone {
  number: string;
  type: '대표' | '상담' | '예약' | '팩스' | '기타';
}

export interface ContactAddress {
  full_address: string;
  sido?: string | null;
  sigungu?: string | null;
}

export interface OperatingHours {
  weekday?: string | null;
  saturday?: string | null;
  sunday?: string | null;
  lunch_break?: string | null;
}

export interface ContactInfo {
  email: ContactEmail[];
  phone: ContactPhone[];
  address?: ContactAddress | null;
  kakao_channel?: string | null;
  naver_booking?: string | null;
  naver_place?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  youtube?: string | null;
  blog?: string | null;
  website_url: string;
  operating_hours?: OperatingHours | null;
}

export interface HospitalAnalysisV54 {
  hospital_name: string;
  doctors: DoctorV54[];
  academic_activities: AcademicActivity[];
  equipment: EquipmentV54[];
  medical_devices?: MedicalDeviceV54[];
  treatments: TreatmentV54[];
  events: EventV54[];
  clinic_categories: ClinicCategory[];
  contact_info?: ContactInfo;
  extraction_summary: {
    total_doctors: number;
    total_academic: number;
    total_equipment: number;
    total_devices?: number;
    total_injectables?: number;
    total_treatments: number;
    total_events: number;
    total_categories: number;
    total_contact_channels?: number;
    has_email?: boolean;
    has_phone?: boolean;
    has_kakao?: boolean;
    has_sns?: boolean;
    price_available_ratio: string;
  };
}

export interface OcrResult {
  source: string;
  text: string;
}

// ============================================================
// v5 기존 타입 (호환 유지)
// ============================================================
export interface AnalysisResult {
  equipments: Array<{ name: string; category: string; manufacturer?: string | null }>;
  treatments: Array<{
    name: string; category: string; price?: number | null;
    price_note?: string | null; is_promoted?: boolean; combo_with?: string | null;
  }>;
  doctors: Array<{
    name: string; title: string; specialty?: string | null;
    education?: string | null; career?: string | null;
    academic_activity?: string | null; notes?: string | null;
  }>;
  events: Array<{
    title: string; description?: string | null;
    discount_type?: string | null; discount_value?: string | null;
    related_treatments?: string[];
  }>;
}

export interface ScreenshotEntry {
  url: string;
  position: string;  // popup, top, mid, bottom, default
  order: number;
}

export interface CrawlPageResult {
  url: string;
  pageType: string;
  markdown: string;
  charCount: number;
  screenshotEntries: ScreenshotEntry[];
  screenshotBuffers: Buffer[];
}

export interface ValidationResult {
  missing_equipments: string[];
  missing_treatments: string[];
  missing_doctors: string[];
  missing_prices: string[];
  coverage_score: {
    equipment: number;
    treatment: number;
    doctor: number;
    overall: number;
  };
  issues: string[];
  _status?: string;
}
