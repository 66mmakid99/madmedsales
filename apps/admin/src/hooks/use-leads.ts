import { useApi } from './use-api';
import type { Lead, LeadActivity } from '@madmedsales/shared';

interface LeadListResult {
  leads: Lead[];
  total: number;
}

interface LeadFilters {
  grade?: string;
  stage?: string;
  interest_level?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

function buildLeadQuery(filters: LeadFilters): string {
  const params = new URLSearchParams();
  if (filters.grade) params.set('grade', filters.grade);
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.interest_level) params.set('interest_level', filters.interest_level);
  if (filters.search) params.set('search', filters.search);
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.offset) params.set('offset', String(filters.offset));
  const qs = params.toString();
  return `/api/leads${qs ? `?${qs}` : ''}`;
}

export function useLeads(filters: LeadFilters): ReturnType<typeof useApi<LeadListResult>> {
  return useApi<LeadListResult>(buildLeadQuery(filters));
}

interface LeadDetail {
  lead: Lead;
  hospital: Record<string, unknown>;
  scoring: Record<string, unknown> | null;
  equipments: Record<string, unknown>[];
  treatments: Record<string, unknown>[];
}

export function useLeadDetail(id: string | undefined): ReturnType<typeof useApi<LeadDetail>> {
  return useApi<LeadDetail>(id ? `/api/leads/${id}` : null);
}

export function useLeadActivities(leadId: string | undefined): ReturnType<typeof useApi<LeadActivity[]>> {
  return useApi<LeadActivity[]>(leadId ? `/api/leads/${leadId}/activities` : null);
}
