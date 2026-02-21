import type { ReactNode } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import type { DailyCost } from '../../hooks/use-costs';

interface Props {
  data: DailyCost[] | null;
  loading: boolean;
}

export function DailyCostChart({ data, loading }: Props): ReactNode {
  if (loading) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">일별 비용 추이</h3>
        <div className="mt-4 h-64 animate-pulse rounded bg-gray-50" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">일별 비용 추이</h3>
        <p className="mt-8 text-center text-sm text-gray-400">데이터 없음</p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    date: d.date.slice(5), // MM-DD
    Claude: Math.round(d.claude * 1450),
    Gemini: Math.round(d.gemini * 1450),
  }));

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="text-sm font-medium text-gray-700">일별 비용 추이 (₩)</h3>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <XAxis dataKey="date" fontSize={11} />
            <YAxis fontSize={11} />
            <Tooltip formatter={(value: number) => `₩${value.toLocaleString()}`} />
            <Legend />
            <Bar dataKey="Claude" stackId="a" fill="#8B5CF6" />
            <Bar dataKey="Gemini" stackId="a" fill="#3B82F6" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
