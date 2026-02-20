import type { ReactNode } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useHospitalDetail } from '../../hooks/use-hospitals';

export function HospitalDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, loading, error } = useHospitalDetail(id);

  if (loading) {
    return <div className="animate-pulse space-y-4">
      <div className="h-8 w-48 rounded bg-gray-200" />
      <div className="h-64 rounded bg-gray-200" />
    </div>;
  }

  if (error || !data) {
    return (
      <div className="text-center">
        <p className="text-red-500">{error ?? '병원을 찾을 수 없습니다.'}</p>
        <button onClick={() => navigate('/hospitals')} className="mt-4 text-sm text-blue-600">
          목록으로
        </button>
      </div>
    );
  }

  const { hospital, equipments, treatments } = data;

  return (
    <div>
      <button
        onClick={() => navigate('/hospitals')}
        className="mb-4 text-sm text-blue-600 hover:underline"
      >
        &larr; 병원 목록
      </button>

      <h2 className="mb-6 text-xl font-bold text-gray-900">{hospital.name}</h2>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-700">기본 정보</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">병원명</dt>
              <dd className="font-medium">{hospital.name}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">원장</dt>
              <dd className="font-medium">{hospital.doctor_name ?? '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">진료과</dt>
              <dd className="font-medium">{hospital.department ?? '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">전화</dt>
              <dd className="font-medium">{hospital.phone ?? '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">이메일</dt>
              <dd className="font-medium">{hospital.email ?? '-'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">주소</dt>
              <dd className="text-right font-medium">
                {hospital.address ?? '-'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">지역</dt>
              <dd className="font-medium">
                {hospital.sido ?? '-'} {hospital.sigungu ?? ''} {hospital.dong ?? ''}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">웹사이트</dt>
              <dd className="font-medium">
                {hospital.website ? (
                  <a
                    href={hospital.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline"
                  >
                    {hospital.website}
                  </a>
                ) : '-'}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">데이터 품질</dt>
              <dd className="flex items-center gap-2">
                <div className="h-2 w-20 rounded bg-gray-200">
                  <div
                    className="h-2 rounded bg-blue-500"
                    style={{ width: `${hospital.data_quality_score}%` }}
                  />
                </div>
                <span className="text-xs font-medium">{hospital.data_quality_score}</span>
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              보유 장비 ({equipments.length})
            </h3>
            {equipments.length === 0 ? (
              <p className="text-sm text-gray-400">장비 정보 없음</p>
            ) : (
              <div className="space-y-2">
                {equipments.map((eq, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">
                        {String(eq.equipment_name ?? '-')}
                      </p>
                      <p className="text-xs text-gray-500">
                        {String(eq.equipment_brand ?? '')} {String(eq.equipment_category ?? '')}
                      </p>
                    </div>
                    {eq.estimated_year ? (
                      <span className="text-xs text-gray-400">
                        {String(eq.estimated_year)}년
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border bg-white p-5 shadow-sm">
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              시술 목록 ({treatments.length})
            </h3>
            {treatments.length === 0 ? (
              <p className="text-sm text-gray-400">시술 정보 없음</p>
            ) : (
              <div className="space-y-2">
                {treatments.map((tr, i) => (
                  <div key={i} className="flex items-center justify-between rounded bg-gray-50 px-3 py-2">
                    <p className="text-sm font-medium text-gray-800">
                      {String(tr.treatment_name ?? '-')}
                    </p>
                    <span className="text-xs text-gray-500">
                      {tr.price_min ? `${Number(tr.price_min).toLocaleString()}원~` : '-'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
