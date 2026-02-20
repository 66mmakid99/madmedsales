import type { ReactNode } from 'react';
import { useRecentActivities } from '../../hooks/use-dashboard';

const ACTIVITY_ICONS: Record<string, string> = {
  email_sent: '📧',
  email_opened: '👁️',
  email_clicked: '🔗',
  email_replied: '💬',
  email_bounced: '⚠️',
  email_unsubscribed: '🚫',
  kakao_connected: '💛',
  kakao_sent: '💬',
  kakao_replied: '💬',
  demo_requested: '🎯',
  demo_completed: '✅',
  demo_evaluated: '⭐',
  page_visited: '🌐',
  stage_changed: '📋',
  note_added: '📝',
  sales_assigned: '👤',
  ai_analysis: '🤖',
};

function formatTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export function RecentActivity(): ReactNode {
  const { data, loading, error } = useRecentActivities();

  return (
    <div className="rounded-lg border bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-semibold text-gray-700">최근 활동</h3>
      {loading && <div className="h-60 animate-pulse rounded bg-gray-200" />}
      {error && <p className="text-xs text-red-500">{error}</p>}
      {!loading && !error && (
        <div className="max-h-80 space-y-3 overflow-y-auto">
          {(!data || data.length === 0) && (
            <p className="text-sm text-gray-400">활동 내역이 없습니다.</p>
          )}
          {data?.map((activity) => (
            <div key={activity.id} className="flex items-start gap-3">
              <span className="mt-0.5 text-base">
                {ACTIVITY_ICONS[activity.activity_type] ?? '📌'}
              </span>
              <div className="flex-1 min-w-0">
                <p className="truncate text-sm font-medium text-gray-800">
                  {activity.title ?? activity.activity_type}
                </p>
                {activity.description && (
                  <p className="truncate text-xs text-gray-500">{activity.description}</p>
                )}
              </div>
              <span className="shrink-0 text-xs text-gray-400">
                {formatTimeAgo(activity.created_at)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
