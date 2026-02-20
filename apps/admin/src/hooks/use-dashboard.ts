import { useApi } from './use-api';
import type { LeadActivity } from '@madmedsales/shared';

interface DashboardKpis {
  totalLeads: number;
  todaySends: number;
  openRate: number;
  demosScheduled: number;
}

interface PipelineData {
  stages: Record<string, number>;
}

interface EmailStats {
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  deliveryRate: number;
  openRate: number;
  clickRate: number;
  replyRate: number;
}

export function useDashboardKpis(): ReturnType<typeof useApi<DashboardKpis>> {
  return useApi<DashboardKpis>('/api/reports/dashboard');
}

export function usePipeline(): ReturnType<typeof useApi<PipelineData>> {
  return useApi<PipelineData>('/api/reports/pipeline');
}

export function useRecentActivities(): ReturnType<typeof useApi<LeadActivity[]>> {
  return useApi<LeadActivity[]>('/api/reports/activities');
}

export function useEmailStats(): ReturnType<typeof useApi<EmailStats>> {
  return useApi<EmailStats>('/api/reports/email-stats');
}
