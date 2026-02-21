import { useState, useEffect, useCallback } from 'react';
import { apiFetchWithPagination } from '../lib/api';
import { useApi } from './use-api';
import type { Hospital } from '@madmedsales/shared';

export interface HospitalListResult {
  hospitals: Hospital[];
  total: number;
}

interface HospitalFilters {
  sido?: string;
  department?: string;
  min_quality?: number;
  search?: string;
  limit?: number;
  offset?: number;
}

function buildHospitalQuery(filters: HospitalFilters): string {
  const params = new URLSearchParams();
  if (filters.sido) params.set('sido', filters.sido);
  if (filters.department) params.set('department', filters.department);
  if (filters.min_quality) params.set('min_quality', String(filters.min_quality));
  if (filters.search) params.set('search', filters.search);
  if (filters.offset !== undefined) {
    const page = Math.floor(filters.offset / (filters.limit ?? 20)) + 1;
    params.set('page', String(page));
  }
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return `/api/hospitals${qs ? `?${qs}` : ''}`;
}

interface UseHospitalsResult {
  data: HospitalListResult | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useHospitals(filters: HospitalFilters): UseHospitalsResult {
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

interface HospitalDetail extends Hospital {
  equipments: Record<string, unknown>[];
  treatments: Record<string, unknown>[];
}

export function useHospitalDetail(
  id: string | undefined
): ReturnType<typeof useApi<HospitalDetail>> {
  return useApi<HospitalDetail>(id ? `/api/hospitals/${id}` : null);
}
