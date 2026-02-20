import { useApi } from './use-api';
import type { Hospital } from '@madmedsales/shared';

interface HospitalListResult {
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
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return `/api/hospitals${qs ? `?${qs}` : ''}`;
}

export function useHospitals(
  filters: HospitalFilters
): ReturnType<typeof useApi<HospitalListResult>> {
  return useApi<HospitalListResult>(buildHospitalQuery(filters));
}

interface HospitalDetail {
  hospital: Hospital;
  equipments: Record<string, unknown>[];
  treatments: Record<string, unknown>[];
}

export function useHospitalDetail(
  id: string | undefined
): ReturnType<typeof useApi<HospitalDetail>> {
  return useApi<HospitalDetail>(id ? `/api/hospitals/${id}` : null);
}
