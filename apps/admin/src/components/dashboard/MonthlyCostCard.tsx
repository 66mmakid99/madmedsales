import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MonthlyCost } from '../../hooks/use-dashboard';

interface Props {
  cost: MonthlyCost;
}

export function MonthlyCostCard({ cost }: Props): ReactNode {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate('/costs')}
      className="w-full rounded-lg border border-gray-100 bg-white p-5 text-left shadow-sm transition-shadow hover:shadow-md"
    >
      <h3 className="mb-3 text-sm font-bold text-slate-800">이번달 AI 비용</h3>
      <div className="space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Gemini</span>
          <span className="font-medium">₩{cost.gemini.toLocaleString()}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-slate-500">Claude</span>
          <span className="font-medium">₩{cost.claude.toLocaleString()}</span>
        </div>
        <div className="flex justify-between border-t pt-1.5">
          <span className="font-medium text-slate-800">합계</span>
          <span className="font-bold text-slate-800">₩{cost.total.toLocaleString()}</span>
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[10px] text-slate-400">
          <span>₩{cost.total.toLocaleString()} / ₩{cost.budget.toLocaleString()}</span>
          <span>{cost.percentage}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-gray-100">
          <div
            className={`h-2 rounded-full transition-all ${cost.percentage > 80 ? 'bg-red-500' : cost.percentage > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${Math.min(cost.percentage, 100)}%` }}
          />
        </div>
      </div>
    </button>
  );
}
