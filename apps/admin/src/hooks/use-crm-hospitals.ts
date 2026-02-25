import { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiFetchWithPagination } from '../lib/api';
import { useApi } from './use-api';
import type { CrmHospital, CrmContact, CrmEquipment, CrmProduct, CrmFranchise } from '@madmedsales/shared';

// ─── 목록 ────────────────────────────────────────────

export interface CrmHospitalContactBrief {
  id: string;
  name: string;
  role: string;
  is_primary: boolean;
}

export interface CrmHospitalEquipmentBrief {
  id: string;
  model_variant: string | null;
  serial_number: string | null;
  status: string;
  product: { name: string } | null;
}

export interface CrmHospitalListItem extends CrmHospital {
  franchise: { id: string; name: string } | null;
  assignee: { id: string; name: string } | null;
  crm_contacts: CrmHospitalContactBrief[];
  crm_equipment: CrmHospitalEquipmentBrief[];
}

interface CrmHospitalFilters {
  search?: string;
  region?: string;
  customer_grade?: string;
  health_status?: string;
  franchise_id?: string;
  page?: number;
  limit?: number;
}

function buildQuery(filters: CrmHospitalFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.region) params.set('region', filters.region);
  if (filters.customer_grade) params.set('customer_grade', filters.customer_grade);
  if (filters.health_status) params.set('health_status', filters.health_status);
  if (filters.franchise_id) params.set('franchise_id', filters.franchise_id);
  params.set('page', String(filters.page ?? 1));
  params.set('limit', String(filters.limit ?? 20));
  return `/api/crm/hospitals?${params.toString()}`;
}

export interface UseCrmHospitalsResult {
  data: { hospitals: CrmHospitalListItem[]; total: number } | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCrmHospitals(filters: CrmHospitalFilters): UseCrmHospitalsResult {
  const [data, setData] = useState<{ hospitals: CrmHospitalListItem[]; total: number } | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const path = buildQuery(filters);

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetchWithPagination<CrmHospitalListItem[]>(path);
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

// ─── 상세 ────────────────────────────────────────────

export interface CrmEquipmentWithProduct extends CrmEquipment {
  product: Pick<CrmProduct, 'id' | 'name' | 'model_variants' | 'warranty_months'> | null;
}

export interface CrmHospitalDetail extends CrmHospital {
  franchise: { id: string; name: string; total_branches: number | null; equipped_branches: number } | null;
  assignee: { id: string; name: string; email: string } | null;
  contacts: CrmContact[];
  equipment: CrmEquipmentWithProduct[];
}

export function useCrmHospitalDetail(
  id: string | undefined
): ReturnType<typeof useApi<CrmHospitalDetail>> {
  return useApi<CrmHospitalDetail>(id ? `/api/crm/hospitals/${id}` : null);
}

// ─── 통계 ────────────────────────────────────────────

export interface CrmHospitalSummary {
  total: number;
  byGrade: { VIP: number; A: number; B: number; C: number };
  byHealth: { green: number; yellow: number; orange: number; red: number };
  attentionCount: number;
}

export function useCrmHospitalSummary(): ReturnType<typeof useApi<CrmHospitalSummary>> {
  return useApi<CrmHospitalSummary>('/api/crm/hospitals/summary');
}

// ─── Mutation helpers ────────────────────────────────

export async function createCrmHospital(body: Record<string, unknown>): Promise<CrmHospital> {
  return apiFetch<CrmHospital>('/api/crm/hospitals', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateCrmHospital(id: string, body: Record<string, unknown>): Promise<CrmHospital> {
  return apiFetch<CrmHospital>(`/api/crm/hospitals/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function createCrmContact(body: Record<string, unknown>): Promise<CrmContact> {
  return apiFetch<CrmContact>('/api/crm/contacts', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateCrmContact(id: string, body: Record<string, unknown>): Promise<CrmContact> {
  return apiFetch<CrmContact>(`/api/crm/contacts/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteCrmContact(id: string): Promise<void> {
  await apiFetch<void>(`/api/crm/contacts/${id}`, { method: 'DELETE' });
}

export async function createCrmEquipment(body: Record<string, unknown>): Promise<CrmEquipmentWithProduct> {
  return apiFetch<CrmEquipmentWithProduct>('/api/crm/equipment', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateCrmEquipment(id: string, body: Record<string, unknown>): Promise<CrmEquipmentWithProduct> {
  return apiFetch<CrmEquipmentWithProduct>(`/api/crm/equipment/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteCrmEquipment(id: string): Promise<void> {
  await apiFetch<void>(`/api/crm/equipment/${id}`, { method: 'DELETE' });
}
