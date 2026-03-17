import { useApi } from './use-api';

export interface LeadDemo {
  id: string;
  demo_type: string;
  status: string;
  scheduled_at: string | null;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
}

interface LeadDemosResult {
  demos: LeadDemo[];
  total: number;
}

export function useLeadDemos(leadId: string | undefined): ReturnType<typeof useApi<LeadDemosResult>> {
  return useApi<LeadDemosResult>(leadId ? `/api/demos?lead_id=${leadId}` : null);
}
