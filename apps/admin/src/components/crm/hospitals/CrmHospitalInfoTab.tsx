import { type ReactNode, useState } from 'react';
import type { CrmHospitalDetail } from '../../../hooks/use-crm-hospitals';
import { updateCrmHospital } from '../../../hooks/use-crm-hospitals';
import { CrmHospitalForm } from './CrmHospitalForm';

interface Props {
  hospital: CrmHospitalDetail;
  onUpdate: () => void;
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }): ReactNode {
  return (
    <div>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-sm text-gray-900 mt-0.5">{value || '-'}</p>
    </div>
  );
}

export function CrmHospitalInfoTab({ hospital, onUpdate }: Props): ReactNode {
  const [editing, setEditing] = useState(false);

  const handleSave = async (body: Record<string, unknown>): Promise<void> => {
    await updateCrmHospital(hospital.id, body);
    setEditing(false);
    onUpdate();
  };

  if (editing) {
    return (
      <CrmHospitalForm
        initial={hospital}
        onSave={handleSave}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* 기본 정보 */}
      <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-600">기본 정보</h2>
          <button
            onClick={() => setEditing(true)}
            className="rounded-lg border border-gray-300 px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
          >
            편집
          </button>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <InfoField label="전화번호" value={hospital.phone} />
          <InfoField label="이메일" value={hospital.email} />
          <InfoField label="주소" value={hospital.address} />
          <InfoField label="지역" value={hospital.region} />
          <InfoField label="카카오채널" value={hospital.kakao_channel} />
          <InfoField label="웹사이트" value={hospital.website} />
        </div>
      </div>

      {/* 분류 */}
      <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">분류</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <InfoField label="고객 등급" value={hospital.customer_grade} />
          <InfoField label="건강도" value={hospital.health_status} />
          <InfoField label="프랜차이즈" value={hospital.franchise?.name ?? '없음'} />
          <InfoField label="담당 영업" value={hospital.assignee?.name ?? '미배정'} />
          <InfoField label="리포트 발송" value={hospital.report_enabled ? '활성' : '비활성'} />
          <InfoField label="리포트 등급" value={hospital.report_tier} />
        </div>
      </div>

      {/* 프랜차이즈 정보 */}
      {hospital.franchise ? (
        <div className="rounded-lg bg-blue-50 p-5 border border-blue-100">
          <h2 className="text-sm font-semibold text-blue-700 mb-2">프랜차이즈 정보</h2>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-blue-500">브랜드</p>
              <p className="font-medium text-blue-900">{hospital.franchise.name}</p>
            </div>
            <div>
              <p className="text-xs text-blue-500">전체 지점</p>
              <p className="font-medium text-blue-900">{hospital.franchise.total_branches ?? '-'}개</p>
            </div>
            <div>
              <p className="text-xs text-blue-500">장비 도입 지점</p>
              <p className="font-medium text-blue-900">{hospital.franchise.equipped_branches}개</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* 메모/태그 */}
      <div className="rounded-lg bg-white p-5 shadow-sm border border-gray-100">
        <h2 className="text-sm font-semibold text-gray-600 mb-4">메모 & 태그</h2>
        <div className="space-y-3">
          <div>
            <p className="text-xs text-gray-500">태그</p>
            <div className="flex flex-wrap gap-1 mt-1">
              {hospital.tags && hospital.tags.length > 0 ? (
                hospital.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-sm text-gray-400">-</span>
              )}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-500">메모</p>
            <p className="text-sm text-gray-900 mt-0.5 whitespace-pre-wrap">{hospital.notes || '-'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
