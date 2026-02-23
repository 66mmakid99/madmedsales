import { useState, useEffect, useCallback } from 'react';
import { useApi } from './use-api';
import { apiFetchWithPagination } from '../lib/api';

export interface CrawlStats {
  totalCrawls: number;
  successCount: number;
  failCount: number;
  avgDuration: string;
  totalCost: number;
}

export interface CrawlItem {
  id: string;
  hospitalName: string;
  hospitalId: string;
  crawlDate: string;
  method: string;
  equipmentCount: number;
  treatmentCount: number;
  pricingCount: number;
  status: string;
}

export function useCrawlStats(): ReturnType<typeof useApi<CrawlStats>> {
  return useApi<CrawlStats>('/api/reports/crawls/stats');
}

interface CrawlListResult {
  crawls: CrawlItem[];
  total: number;
  totalPages: number;
}

export function useCrawls(page: number, limit: number = 20): { data: CrawlListResult | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<CrawlListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetchWithPagination<CrawlItem[]>(`/api/reports/crawls?page=${page}&limit=${limit}`);
      setData({
        crawls: result.data,
        total: result.pagination?.total ?? 0,
        totalPages: result.pagination?.totalPages ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error };
}
