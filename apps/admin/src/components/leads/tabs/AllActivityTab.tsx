import type { ReactNode } from 'react';
import type { LeadActivity } from '@madmedsales/shared';

const ACTIVITY_ICONS: Record<string, string> = {
  email_sent: '📧',
  email_opened: '👁',
  email_clicked: '🖱',
  email_replied: '↩️',
  email_bounced: '⚠️',
  email_unsubscribed: '🚫',
  kakao_connected: '💬',
  kakao_sent: '💬',
  kakao_replied: '↩️',
  demo_requested: '🏥',
  demo_completed: '✅',
  demo_evaluated: '⭐',
  page_visited: '🌐',
  stage_changed: '→',
  note_added: '📝',
  sales_assigned: '👤',
  ai_analysis: '🤖',
};

const TYPE_LABELS: Record<string, string> = {
  email_sent: '이메일 발송',
  email_opened: '이메일 열람',
  email_clicked: '이메일 클릭',
  email_replied: '이메일 답장',
  email_bounced: '이메일 반송',
  email_unsubscribed: '수신 거부',
  kakao_connected: '카카오 연결',
  kakao_sent: '카카오 발송',
  kakao_replied: '카카오 답장',
  demo_requested: '데모 요청',
  demo_completed: '데모 완료',
  demo_evaluated: '데모 평가',
  page_visited: '페이지 방문',
  stage_changed: '단계 변경',
  note_added: '메모 추가',
  sales_assigned: '영업 배정',
  ai_analysis: 'AI 분석',
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface AllActivityTabProps {
  activities: LeadActivity[];
  loading: boolean;
  error: string | null;
}

export function AllActivityTab({ activities, loading, error }: AllActivityTabProps): ReactNode {
  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 rounded bg-gray-100" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-red-500">{error}</p>;
  }

  if (activities.length === 0) {
    return <p className="text-sm text-gray-400">활동 내역이 없습니다.</p>;
  }

  return (
    <div className="space-y-0">
      {activities.map((activity, idx) => (
        <div key={activity.id} className="relative flex gap-3 pb-4">
          <div className="flex flex-col items-center">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm">
              {ACTIVITY_ICONS[activity.activity_type] ?? '•'}
            </div>
            {idx < activities.length - 1 && (
              <div className="mt-1 w-px flex-1 bg-gray-200" />
            )}
          </div>
          <div className="flex-1 pb-2 pt-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-800">
                {TYPE_LABELS[activity.activity_type] ?? activity.activity_type}
              </span>
              <span className="text-xs text-gray-400">
                {formatDate(activity.created_at)}
              </span>
            </div>
            {activity.title && (
              <p className="mt-0.5 text-sm text-gray-600">{activity.title}</p>
            )}
            {activity.description && (
              <p className="mt-0.5 text-xs text-gray-500">{activity.description}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
