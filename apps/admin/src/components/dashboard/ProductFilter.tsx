import type { ReactNode } from 'react';
import { useRevenueReport } from '../../hooks/use-dashboard';

export function ProductFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (productName: string) => void;
}): ReactNode {
  const { data } = useRevenueReport();
  const products = data?.productSummary ?? [];

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none"
    >
      <option value="">전체 제품</option>
      {products.map((p) => (
        <option key={p.productId} value={p.productName}>{p.productName}</option>
      ))}
    </select>
  );
}
