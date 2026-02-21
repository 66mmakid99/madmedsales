import type { ReactNode } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { PurposeCost } from '../../hooks/use-costs';

interface Props {
  data: PurposeCost[] | null;
  loading: boolean;
}

const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444'];

const PURPOSE_LABELS: Record<string, string> = {
  web_analysis: '웹 분석',
  scoring: '스코어링',
  email_generation: '이메일 생성',
  reply_analysis: '답장 분석',
  tone_adapt: '톤 변환',
};

export function PurposeBreakdown({ data, loading }: Props): ReactNode {
  if (loading) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">용도별 비용 분포</h3>
        <div className="mt-4 h-64 animate-pulse rounded bg-gray-50" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-4">
        <h3 className="text-sm font-medium text-gray-700">용도별 비용 분포</h3>
        <p className="mt-8 text-center text-sm text-gray-400">데이터 없음</p>
      </div>
    );
  }

  const chartData = data.map((d) => ({
    name: PURPOSE_LABELS[d.purpose] ?? d.purpose,
    value: d.costKrw,
    calls: d.calls,
  }));

  return (
    <div className="rounded-lg border bg-white p-4">
      <h3 className="text-sm font-medium text-gray-700">용도별 비용 분포</h3>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={80}
              label={({ name, percent }: { name: string; percent: number }) =>
                `${name} ${(percent * 100).toFixed(0)}%`
              }
              labelLine={false}
              fontSize={11}
            >
              {chartData.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value: number, name: string, props: { payload: { calls: number } }) =>
                [`₩${value.toLocaleString()} (${props.payload.calls}회)`, name]
              }
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
