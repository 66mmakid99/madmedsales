import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLeads } from '../../hooks/use-leads';

export function HotLeadAlerts(): ReactNode {
  const navigate = useNavigate();
  const { data, loading } = useLeads({ interest_level: 'hot', limit: 5 });

  const hotLeads = data?.leads ?? [];
  const total = data?.total ?? 0;

  if (loading) {
    return <div className="h-36 animate-pulse rounded-lg bg-gray-200" />;
  }

  if (total === 0) return null;

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-red-700">HOT 리드 알림</h3>
        <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">
          {total}
        </span>
      </div>
      <ul className="space-y-2">
        {hotLeads.map((lead) => (
          <li
            key={lead.id}
            onClick={() => navigate(`/leads/${lead.id}`)}
            className="flex cursor-pointer items-center justify-between rounded bg-white px-3 py-2 shadow-sm hover:bg-red-50"
          >
            <div className="flex items-center gap-2">
              <span className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {lead.grade ?? '-'}
              </span>
              <span className="text-sm font-medium text-gray-800">
                {lead.contact_name ?? '미정'}
              </span>
            </div>
            <span className="text-xs text-gray-400">
              {lead.stage}
            </span>
          </li>
        ))}
      </ul>
      {total > 5 && (
        <button
          onClick={() => navigate('/leads?interest_level=hot')}
          className="mt-2 w-full text-center text-xs text-red-600 hover:underline"
        >
          전체 {total}건 보기
        </button>
      )}
    </div>
  );
}
