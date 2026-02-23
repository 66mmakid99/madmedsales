import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ActivityItem } from '../../hooks/use-dashboard';

interface Props {
  activities: ActivityItem[];
}

function relativeTime(iso: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

const TYPE_ICONS: Record<string, { icon: string; color: string }> = {
  profile: { icon: '✅', color: 'bg-emerald-100' },
  crawl: { icon: '📡', color: 'bg-blue-100' },
};

export function RecentActivityFeed({ activities }: Props): ReactNode {
  const navigate = useNavigate();

  return (
    <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-bold text-slate-800">최근 활동</h3>
      {activities.length === 0 ? (
        <p className="text-sm text-slate-400">활동 내역이 없습니다</p>
      ) : (
        <div className="space-y-3">
          {activities.map((a, i) => {
            const meta = TYPE_ICONS[a.type] ?? { icon: '📋', color: 'bg-gray-100' };
            return (
              <button
                key={i}
                onClick={() => navigate(`/hospitals/${a.hospitalId}`)}
                className="flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50"
              >
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs ${meta.color}`}>
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {a.hospital}
                    <span className="ml-1 text-xs text-slate-400">
                      {a.type === 'profile' ? '프로파일 완료' : '크롤 완료'}
                    </span>
                  </p>
                  <p className="text-xs text-slate-500">{a.detail}</p>
                </div>
                <span className="shrink-0 text-[10px] text-slate-400">{relativeTime(a.time)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
