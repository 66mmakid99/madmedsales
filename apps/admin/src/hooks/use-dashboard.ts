import { useApi } from './use-api';
import type { LeadActivity } from '@madmedsales/shared';

interface DashboardKpis {
  totalLeads: number;
  todaySends: number;
  openRate: number;
  demosScheduled: number;
}

interface LegacyPipelineData {
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

// ── 대시보드 통합 ──

export interface DashboardStatsKpi {
  totalHospitals: number;
  profiledCount: number;
  pendingCrawl: number;
  weekCrawls: number;
}

export interface PipelineData {
  phase1_collected: number;
  phase2_profiled: number;
  phase3_leads: number;
  phase4_contacted: number;
  phase5_responded: number;
  phase6_contracted: number;
}

export interface DataCollectionItem {
  count: number;
  percentage: number;
}

export interface DataCollectionStats {
  totalHospitals: number;
  withEquipment: DataCollectionItem;
  withTreatment: DataCollectionItem;
  withPricing: DataCollectionItem;
}

export interface ActivityItem {
  type: string;
  hospital: string;
  hospitalId: string;
  detail: string;
  time: string;
}

export interface CrawlHistoryItem {
  id: string;
  hospitalName: string;
  hospitalId: string;
  crawledAt: string;
  tier: string | null;
  equipmentsCount: number;
  treatmentsCount: number;
  pricingCount: number;
  diffSummary: string | null;
  status: 'success' | 'failed';
}

export interface MonthlyCost {
  gemini: number;
  claude: number;
  total: number;
  budget: number;
  percentage: number;
}

export interface DashboardStats {
  kpi: DashboardStatsKpi;
  pipeline: PipelineData;
  dataCollection: DataCollectionStats;
  gradeDistribution: Record<string, number>;
  profileGradeDistribution: Record<string, number>;
  recentActivity: ActivityItem[];
  recentCrawls: CrawlHistoryItem[];
  monthlyCost: MonthlyCost;
}

export function useDashboardStats(): ReturnType<typeof useApi<DashboardStats>> {
  return useApi<DashboardStats>('/api/reports/dashboard/stats');
}

// ── 매칭 상세 내역 ──

export interface AngleBreakdown {
  id: string;
  label: string;
  weight: number;
  score: number;
  weightedScore: number;
}

export interface MatchDetailItem {
  hospitalId: string;
  hospitalName: string;
  region: string | null;
  department: string | null;
  productName: string;
  profileGrade: string | null;
  matchGrade: string;
  totalScore: number;
  topPitchPoints: string[];
  scoringVersion: string;
  scoredAt: string;
  angleBreakdown: AngleBreakdown[];
}

export function useMatchDetails(): ReturnType<typeof useApi<MatchDetailItem[]>> {
  return useApi<MatchDetailItem[]>('/api/reports/dashboard/matches');
}

export function usePipeline(): ReturnType<typeof useApi<LegacyPipelineData>> {
  return useApi<LegacyPipelineData>('/api/reports/pipeline');
}

export function useRecentActivities(): ReturnType<typeof useApi<LeadActivity[]>> {
  return useApi<LeadActivity[]>('/api/reports/activities');
}

export function useEmailStats(): ReturnType<typeof useApi<EmailStats>> {
  return useApi<EmailStats>('/api/reports/email-stats');
}
