import { useState, type ReactNode } from 'react';
import type { HospitalEquipment, HospitalTreatment, HospitalPricing } from '../../hooks/use-hospitals';

interface Props {
  equipments: HospitalEquipment[];
  treatments: HospitalTreatment[];
  pricing: HospitalPricing[];
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

function formatPrice(val: number | null): string {
  if (val === null || val === undefined) return '-';
  return `${Number(val).toLocaleString()}원`;
}

const RF_KEYWORDS = ['rf', '써마지', '인모드', '포텐자', '올리지오', '테너', '볼뉴머', 'thermage', 'inmode', 'potenza'];

function CollapsibleCategory({ category, children }: { category: string; children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="mb-1.5 flex w-full items-center gap-1 text-left"
      >
        <svg
          className={`h-3 w-3 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span className="text-xs font-medium uppercase text-slate-400">{category}</span>
      </button>
      {open && children}
    </div>
  );
}

export function HospitalDataTab({ equipments, treatments, pricing }: Props): ReactNode {
  const equipByCategory = groupBy(equipments, (e) => e.equipment_category ?? '기타');
  const treatByCategory = groupBy(treatments, (t) => t.treatment_category ?? '기타');

  const rfEquipments = equipments.filter((e) =>
    RF_KEYWORDS.some((kw) => e.equipment_name?.toLowerCase().includes(kw.toLowerCase()) || e.equipment_category?.toLowerCase() === 'rf')
  );

  return (
    <div className="space-y-6">
      {/* TORR RF 영업 포인트 하이라이트 */}
      <div className={`rounded-lg border-2 p-4 ${rfEquipments.length > 0 ? 'border-red-300 bg-red-50' : 'border-orange-200 bg-orange-50'}`}>
        <p className="text-sm font-bold text-red-800">🔴 TORR RF 영업 포인트</p>
        {rfEquipments.length > 0 ? (
          <p className="mt-1 text-sm text-red-700">
            RF 장비 {rfEquipments.length}종 보유 ({rfEquipments.map((e) => e.equipment_name).join(', ')})
            → 기존 RF 대비 차별점 앵글 유효
          </p>
        ) : (
          <p className="mt-1 text-sm text-orange-700">
            RF 장비 미보유 → 신규 도입 앵글로 접근
          </p>
        )}
      </div>

      {/* 장비 목록 */}
      <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">보유 장비 ({equipments.length})</h3>
        {equipments.length === 0 ? (
          <p className="text-sm text-slate-400">장비 정보 없음</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(equipByCategory).map(([category, items]) => (
              <CollapsibleCategory key={category} category={category}>
                <div className="space-y-1.5">
                  {items.map((eq) => (
                    <div key={eq.id} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-800">{eq.equipment_name ?? '-'}</p>
                        {eq.is_confirmed ? (
                          <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700">확인됨</span>
                        ) : (
                          <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-medium text-yellow-700">추정</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-500">
                        {eq.equipment_brand ? <span>{eq.equipment_brand}</span> : null}
                        {eq.equipment_model ? <span className="text-slate-400">{eq.equipment_model}</span> : null}
                        {eq.estimated_year ? <span>{eq.estimated_year}년</span> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </CollapsibleCategory>
            ))}
          </div>
        )}
      </div>

      {/* 시술 목록 */}
      <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">시술 목록 ({treatments.length})</h3>
        {treatments.length === 0 ? (
          <p className="text-sm text-slate-400">시술 정보 없음</p>
        ) : (
          <div className="space-y-4">
            {Object.entries(treatByCategory).map(([category, items]) => (
              <CollapsibleCategory key={category} category={category}>
                <div className="space-y-1.5">
                  {items.map((tr) => (
                    <div key={tr.id} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-slate-800">{tr.treatment_name ?? '-'}</p>
                        {tr.is_promoted ? (
                          <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-orange-700">프로모션</span>
                        ) : null}
                      </div>
                      <span className="text-xs text-slate-500">
                        {tr.price_min ? formatPrice(tr.price_min) : ''}
                        {tr.price_min && tr.price_max ? ' ~ ' : ''}
                        {tr.price_max ? formatPrice(tr.price_max) : ''}
                        {!tr.price_min && !tr.price_max ? '-' : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </CollapsibleCategory>
            ))}
          </div>
        )}
      </div>

      {/* 가격 정보 */}
      <div className="rounded-lg border border-gray-100 bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-slate-800">가격 정보 ({pricing.length})</h3>
        {pricing.length === 0 ? (
          <p className="text-sm text-slate-400">이 병원은 웹사이트에 가격을 공개하지 않습니다</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-slate-500">
                  <th className="pb-2 pr-3 font-medium">시술명</th>
                  <th className="pb-2 pr-3 font-medium">표준명</th>
                  <th className="pb-2 pr-3 text-right font-medium">가격</th>
                  <th className="pb-2 pr-3 text-right font-medium">단가</th>
                  <th className="pb-2 pr-3 font-medium">단위</th>
                  <th className="pb-2 pr-3 font-medium">이벤트</th>
                  <th className="pb-2 font-medium">신뢰도</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pricing.map((p, i) => (
                  <tr key={i} className="text-slate-800">
                    <td className="py-2 pr-3 font-medium">{p.treatment_name}</td>
                    <td className="py-2 pr-3 text-slate-500">{p.standard_name ?? '-'}</td>
                    <td className="py-2 pr-3 text-right">{formatPrice(p.total_price)}</td>
                    <td className="py-2 pr-3 text-right">{p.unit_price ? `${Number(p.unit_price).toLocaleString()}` : '-'}</td>
                    <td className="py-2 pr-3 text-slate-500">{p.unit_type ?? '-'}</td>
                    <td className="py-2 pr-3">
                      {p.is_event_price ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">{p.event_label ?? '이벤트'}</span>
                      ) : '-'}
                    </td>
                    <td className="py-2 text-xs text-slate-500">{p.confidence_level ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
