import { useApi } from './use-api';
import { apiFetch } from '../lib/api';
import type { CrmProduct, CrmFranchise } from '@madmedsales/shared';

export function useCrmProducts(): ReturnType<typeof useApi<CrmProduct[]>> {
  return useApi<CrmProduct[]>('/api/crm/products');
}

export function useCrmFranchises(): ReturnType<typeof useApi<Array<CrmFranchise & { hospital_count: number }>>> {
  return useApi<Array<CrmFranchise & { hospital_count: number }>>('/api/crm/franchises');
}

export async function createCrmProduct(body: Record<string, unknown>): Promise<CrmProduct> {
  return apiFetch<CrmProduct>('/api/crm/products', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function updateCrmProduct(id: string, body: Record<string, unknown>): Promise<CrmProduct> {
  return apiFetch<CrmProduct>(`/api/crm/products/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}
