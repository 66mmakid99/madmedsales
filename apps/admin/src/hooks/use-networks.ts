import { useState, useCallback } from 'react';
import { useApi } from './use-api';
import { apiFetch } from '../lib/api';
import type {
  Network,
  NetworkWithStats,
  NetworkBranchWithHospital,
  ConfidenceLevel,
} from '@madmedsales/shared';

// ===== 네트워크 목록 =====
export function useNetworks(): ReturnType<typeof useApi<NetworkWithStats[]>> {
  return useApi<NetworkWithStats[]>('/api/networks');
}

// ===== 네트워크 상세 =====
export function useNetwork(id: string | undefined): ReturnType<typeof useApi<Network>> {
  return useApi<Network>(id ? `/api/networks/${id}` : null);
}

// ===== 네트워크 지점 목록 =====
export function useNetworkBranches(
  networkId: string | undefined,
  confidence?: ConfidenceLevel,
): ReturnType<typeof useApi<NetworkBranchWithHospital[]>> {
  let path: string | null = null;
  if (networkId) {
    path = `/api/networks/${networkId}/branches`;
    if (confidence) path += `?confidence=${confidence}`;
  }
  return useApi<NetworkBranchWithHospital[]>(path);
}

// ===== 전체 통계 =====
export interface NetworkSummary {
  totalNetworks: number;
  activeNetworks: number;
  unverifiedNetworks: number;
  totalBranches: number;
  confirmedBranches: number;
  probableBranches: number;
  candidateBranches: number;
  unlikelyBranches: number;
}

export function useNetworkSummary(): ReturnType<typeof useApi<NetworkSummary>> {
  return useApi<NetworkSummary>('/api/networks/summary');
}

// ===== 지점 검증 액션 =====
interface UseVerifyBranchResult {
  verifying: boolean;
  error: string | null;
  verify: (branchId: string, confidence: ConfidenceLevel, notes?: string) => Promise<boolean>;
  remove: (branchId: string, reason?: string) => Promise<boolean>;
}

export function useVerifyBranch(): UseVerifyBranchResult {
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = useCallback(async (
    branchId: string,
    confidence: ConfidenceLevel,
    notes?: string,
  ): Promise<boolean> => {
    setVerifying(true);
    setError(null);
    try {
      await apiFetch(`/api/networks/branches/${branchId}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ confidence, verification_notes: notes }),
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    } finally {
      setVerifying(false);
    }
  }, []);

  const remove = useCallback(async (branchId: string, reason?: string): Promise<boolean> => {
    setVerifying(true);
    setError(null);
    try {
      await apiFetch(`/api/networks/branches/${branchId}/remove`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      return false;
    } finally {
      setVerifying(false);
    }
  }, []);

  return { verifying, error, verify, remove };
}
