import { useState, useEffect, useCallback } from 'react';
import { apiFetchWithPagination } from '../lib/api';
import { useApi } from './use-api';
import type { Hospital } from '@madmedsales/shared';

export interface HospitalListResult {
  hospitals: Hospital[];
  total: number;
}

/** 프로파일링 완료 병원 (enriched) */
export interface ProfiledHospital extends Hospital {
  profile_grade: string | null;
  equipment_count: number;
  treatment_count: number;
  pricing_count: number;
  best_match_grade: string | null;
  last_crawled_at: string | null;
}

export interface ProfiledHospitalListResult {
  hospitals: ProfiledHospital[];
  total: number;
}

/** 전체 병원 (enriched with is_profiled) */
export interface EnrichedHospital extends Hospital {
  is_profiled?: boolean;
}

export interface EnrichedHospitalListResult {
  hospitals: EnrichedHospital[];
  total: number;
}

/** 병원 DB 요약 통계 */
export interface HospitalSummary {
  total: number;
  profiled: number;
  crawledOnly: number;
  uncollected: number;
}

interface HospitalFilters {
  sido?: string;
  department?: string;
  min_quality?: number;
  search?: string;
  limit?: number;
  offset?: number;
  profiled?: boolean;
  enrich?: boolean;
}

function buildHospitalQuery(filters: HospitalFilters): string {
  const params = new URLSearchParams();
  if (filters.sido) params.set('sido', filters.sido);
  if (filters.department) params.set('department', filters.department);
  if (filters.min_quality) params.set('min_quality', String(filters.min_quality));
  if (filters.search) params.set('search', filters.search);
  if (filters.profiled) params.set('profiled', 'true');
  if (filters.enrich) params.set('enrich', 'true');
  if (filters.offset !== undefined) {
    const page = Math.floor(filters.offset / (filters.limit ?? 20)) + 1;
    params.set('page', String(page));
  }
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return `/api/hospitals${qs ? `?${qs}` : ''}`;
}

interface UseHospitalsResult<T> {
  data: { hospitals: T[]; total: number } | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useHospitals(filters: HospitalFilters): UseHospitalsResult<Hospital> {
  const [data, setData] = useState<HospitalListResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const path = buildHospitalQuery(filters);

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetchWithPagination<Hospital[]>(path);
      setData({
        hospitals: result.data,
        total: result.pagination?.total ?? 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useProfiledHospitals(filters: Omit<HospitalFilters, 'profiled'>): UseHospitalsResult<ProfiledHospital> {
  const [data, setData] = useState<ProfiledHospitalListResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const path = buildHospitalQuery({ ...filters, profiled: true });

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetchWithPagination<ProfiledHospital[]>(path);
      setData({
        hospitals: result.data,
        total: result.pagination?.total ?? 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useEnrichedHospitals(filters: Omit<HospitalFilters, 'enrich'>): UseHospitalsResult<EnrichedHospital> {
  const [data, setData] = useState<EnrichedHospitalListResult | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const path = buildHospitalQuery({ ...filters, enrich: true });

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetchWithPagination<EnrichedHospital[]>(path);
      setData({
        hospitals: result.data,
        total: result.pagination?.total ?? 0,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}

export function useHospitalSummary(): { data: HospitalSummary | null; loading: boolean; error: string | null } {
  return useApi<HospitalSummary>('/api/hospitals/summary');
}

export interface HospitalEquipment {
  id: string;
  equipment_name: string | null;
  equipment_brand: string | null;
  equipment_category: string | null;
  equipment_model: string | null;
  estimated_year: number | null;
  is_confirmed: boolean | null;
  source: string | null;
}

export interface HospitalTreatment {
  id: string;
  treatment_name: string | null;
  treatment_category: string | null;
  price_min: number | null;
  price_max: number | null;
  is_promoted: boolean | null;
  source: string | null;
}

export interface HospitalProfile {
  investment_score: number;
  portfolio_diversity_score: number;
  practice_scale_score: number;
  marketing_activity_score: number;
  profile_score: number;
  profile_grade: string | null;
  ai_summary: string | null;
  main_focus: string | null;
  target_audience: string | null;
  analyzed_at: string | null;
}

export interface ProductMatchScore {
  product_id: string;
  product_name: string;
  total_score: number;
  grade: string | null;
  sales_angle_scores: Record<string, number> | null;
  top_pitch_points: string[] | null;
  scoring_version: string | null;
  scored_at: string | null;
}

export interface HospitalPricing {
  treatment_name: string;
  standard_name: string | null;
  total_price: number | null;
  unit_price: number | null;
  unit_type: string | null;
  is_event_price: boolean | null;
  event_label: string | null;
  confidence_level: string | null;
  crawled_at: string | null;
}

export interface CrawlSnapshot {
  crawled_at: string;
  tier: string | null;
  equipments_found: unknown[] | null;
  treatments_found: unknown[] | null;
  pricing_found: unknown[] | null;
  diff_summary: string | null;
}

export interface DataSummary {
  equipmentCount: number;
  treatmentCount: number;
  pricingCount: number;
  crawlCount: number;
  lastCrawledAt: string | null;
  profileGrade: string | null;
}

export interface ScoreLineItem {
  label: string;
  value: string;
  points: number;
  maxPoints: number;
}

export interface AxisBreakdown {
  axisLabel: string;
  weight: number;
  totalScore: number;
  weightedScore: number;
  items: ScoreLineItem[];
}

export type ScoreBreakdown = AxisBreakdown[];

interface HospitalDetail extends Hospital {
  equipments: HospitalEquipment[];
  treatments: HospitalTreatment[];
  profile: HospitalProfile | null;
  scoreBreakdown: ScoreBreakdown | null;
  matchScores: ProductMatchScore[];
  pricing: HospitalPricing[];
  crawlHistory: CrawlSnapshot[];
  dataSummary: DataSummary;
}

export function useHospitalDetail(
  id: string | undefined
): ReturnType<typeof useApi<HospitalDetail>> {
  return useApi<HospitalDetail>(id ? `/api/hospitals/${id}` : null);
}
