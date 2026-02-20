import { useApi } from './use-api';
import type { Demo, DemoEvaluation } from '@madmedsales/shared';

interface DemoListResult {
  demos: Demo[];
  total: number;
}

interface DemoFilters {
  status?: string;
  lead_id?: string;
  limit?: number;
  offset?: number;
}

function buildDemoQuery(filters: DemoFilters): string {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.lead_id) params.set('lead_id', filters.lead_id);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return `/api/demos${qs ? `?${qs}` : ''}`;
}

export function useDemos(
  filters: DemoFilters
): ReturnType<typeof useApi<DemoListResult>> {
  return useApi<DemoListResult>(buildDemoQuery(filters));
}

interface DemoDetailResult {
  demo: Demo;
  evaluation: DemoEvaluation | null;
}

export function useDemoDetail(
  id: string | undefined
): ReturnType<typeof useApi<DemoDetailResult>> {
  return useApi<DemoDetailResult>(id ? `/api/demos/${id}` : null);
}
