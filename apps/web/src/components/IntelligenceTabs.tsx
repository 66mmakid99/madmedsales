import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { ServerCrash, Stethoscope, BriefcaseMedical, Cpu, Layers, X, Database, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';

export default function IntelligenceTabs() {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 모달 상태 관리
  const [selectedDevice, setSelectedDevice] = useState<any | null>(null);
  
  // 미분류 데이터 폴딩 상태
  const [showUnclassified, setShowUnclassified] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        const { data, error } = await supabase
          .from('sales_medical_devices')
          .select('*')
          .limit(1000); // 프론트에서 정렬 및 필터링을 위해 충분한 데이터를 가져옴

        if (error) {
          throw new Error(error.message);
        }
        
        if (data) {
          setDevices(data);
        }
      } catch (err: any) {
        console.error('DB 렌더링 에러:', err.message);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  // 1. 데이터 클리닝 및 3. 정렬 로직 (메모이제이션)
  const { validDevices, unclassifiedDevices } = useMemo(() => {
    const valid: any[] = [];
    const unclass: any[] = [];

    devices.forEach((d) => {
      const name = d?.name || d?.model_name || d?.device_name;
      const manufacturer = d?.manufacturer || d?.company;
      
      const hasValidName = name && name.trim() !== '';

      // [핵심 버그 픽스] 제조사명(manufacturer)이 null 이어도 이름(name)만 있으면 메인 유효 장비로 인정합니다.
      if (hasValidName) {
        valid.push(d);
      } else {
        // 이름이 빠졌지만 다른 의미 있는 데이터(원문 등)가 있는 경우 미분류로
        if (d?.raw_text || d?.description || manufacturer) {
          unclass.push(d);
        }
      }
    });

    // 정렬 로직 (null/undefined 에러 원천 차단)
    // 제조사 이름순(ABC/가나다) 정렬, 제조사가 둘 다 null이거나 같으면 장비명 순
    valid.sort((a, b) => {
      // fallback string으로 처리하여 undefined.toLowerCase() 에러를 완벽 방어합니다.
      const mfgA = (a?.manufacturer || a?.company || '').toLowerCase();
      const mfgB = (b?.manufacturer || b?.company || '').toLowerCase();
      
      if (mfgA !== mfgB) return mfgA.localeCompare(mfgB);
      
      const nameA = (a?.name || a?.model_name || a?.device_name || '').toLowerCase();
      const nameB = (b?.name || b?.model_name || b?.device_name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

    return { validDevices: valid, unclassifiedDevices: unclass };
  }, [devices]);

  // 에러 발생 시 UI
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-12 bg-red-50 rounded-2xl border border-red-100">
        <ServerCrash className="w-12 h-12 text-red-500 mb-4" />
        <h3 className="text-xl font-bold text-red-700 mb-2">데이터베이스 연결 오류</h3>
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  // 카드 렌더링 헬퍼 함수
  const renderDeviceCard = (device: any, isUnclassified: boolean = false) => {
    const displayName = device?.name || device?.model_name || device?.device_name || '모델명 미상';
    const displayManufacturer = device?.manufacturer || device?.company || '제조사 미상';
    const displayDesc = device?.raw_text || device?.description || device?.spec || '상세 제원이나 설명이 등록되지 않았습니다.';
    const displayType = device?.device_type || device?.tech_classification;

    return (
      <div 
        key={device?.id || Math.random()} 
        className={`group flex flex-col p-6 border rounded-xl hover:shadow-lg transition-all duration-300 h-full ${
          isUnclassified ? 'bg-slate-50 border-slate-200 hover:border-slate-300' : 'bg-white border-slate-200 hover:border-blue-300'
        }`}
      >
        {/* 제조사명 */}
        <div className={`text-sm font-semibold mb-3 flex items-center gap-1.5 ${isUnclassified ? 'text-slate-500' : 'text-blue-600'}`}>
          <Stethoscope className="w-4 h-4" />
          {displayManufacturer}
        </div>
        
        {/* 장비명 */}
        <h3 className={`text-xl font-extrabold mb-3 transition-colors ${
          isUnclassified 
            ? 'text-slate-700 group-hover:text-slate-900' 
            : 'text-slate-800 group-hover:text-blue-700'
        }`}>
          {displayName}
          {device?.korean_name && <span className="ml-2 text-sm font-medium text-slate-400">({device.korean_name})</span>}
        </h3>
        
        {/* 설명 Raw Text */}
        <p className="text-slate-500 text-sm mb-6 flex-grow line-clamp-3 leading-relaxed">
          {displayDesc}
        </p>

        {/* 기술/스펙 바텀 태그 & 상세보기 버튼 */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-auto pt-4 border-t border-slate-100">
          <div className="flex gap-2 flex-wrap">
            {displayType && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-opacity-50 ${
                isUnclassified ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-indigo-50 text-indigo-700 border-indigo-100'
              }`}>
                <Cpu className="w-3.5 h-3.5" />
                {displayType}
              </span>
            )}
            {device?.subcategory && (
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-opacity-50 ${
                isUnclassified ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-emerald-50 text-emerald-700 border-emerald-100'
              }`}>
                <Layers className="w-3.5 h-3.5" />
                {device.subcategory}
              </span>
            )}
          </div>
          
          <button 
            onClick={() => setSelectedDevice(device)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200 hover:bg-slate-200 hover:text-blue-600 transition-colors cursor-pointer"
          >
            <Database className="w-3.5 h-3.5" />
            상세(JSON)
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden relative">
      {/* 탭 헤더 영역 */}
      <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg shadow-sm">
            <BriefcaseMedical className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-slate-900">의료기기 마스터 DB</h2>
            <p className="text-slate-500 text-sm mt-1">
              영업 파이프라인 분석을 위한 장비 라인업 및 기술 분류 인텔리전스
            </p>
          </div>
        </div>
        
        {/* 2. 총 데이터 개수 요약 카운트 */}
        {!loading && (
          <div className="flex gap-3">
            <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-100 px-4 py-2 rounded-full shadow-sm">
              <Database className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-bold text-emerald-800">
                유효 장비: <span className="text-emerald-600 text-base">{validDevices.length}</span>건
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 메인 콘텐츠 영역 */}
      <div className="p-6 bg-slate-50/50">
        {loading ? (
          // 로딩 중 (스켈레톤 UI)
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="p-6 border border-slate-200 rounded-xl bg-white animate-pulse">
                <div className="h-4 bg-slate-200 rounded w-1/3 mb-4"></div>
                <div className="h-6 bg-slate-300 rounded w-2/3 mb-6"></div>
                <div className="flex gap-2">
                  <div className="h-8 bg-slate-100 rounded-full w-20"></div>
                  <div className="h-8 bg-slate-100 rounded-full w-24"></div>
                </div>
              </div>
            ))}
          </div>
        ) : validDevices.length > 0 ? (
          // 3. 정렬된 유효 데이터 렌더링
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
            {validDevices.map((device) => renderDeviceCard(device, false))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed border-slate-200 bg-white rounded-xl">
            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-5">
              <BriefcaseMedical className="w-10 h-10 text-slate-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-800 mb-2">유효한 등록 장비가 없습니다</h3>
            <p className="text-slate-500">크롤러를 가동하여 완전한 의료기기 데이터를 수집해 주세요.</p>
          </div>
        )}

        {/* 4. '기타/미분류' 섹션 분리 (아코디언 형태) */}
        {!loading && unclassifiedDevices.length > 0 && (
          <div className="mt-12 border-t border-slate-200 pt-8">
            <button 
              onClick={() => setShowUnclassified(!showUnclassified)}
              className="flex items-center gap-2 mb-6 group outline-none"
            >
              <div className="p-1.5 bg-amber-100 text-amber-600 rounded-md group-hover:bg-amber-200 transition-colors">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-slate-700 group-hover:text-slate-900 transition-colors">
                미분류 데이터 보관함 <span className="text-slate-400 text-base font-medium">({unclassifiedDevices.length}건)</span>
              </h3>
              {showUnclassified ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
            </button>
            
            <p className="text-slate-500 text-sm mb-6 max-w-3xl">
              제조사 또는 장비명이 명확하게 식별되지 않았으나, 식약처나 웹에서 크롤링된 일부 정보를 담고 있는 데이터들입니다. 
              수동 검수를 통해 마스터 데이터로 편입할 수 있습니다.
            </p>

            {showUnclassified && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 opacity-80">
                {unclassifiedDevices.map((device) => renderDeviceCard(device, true))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* JSON 상세 보기 모달 */}
      {selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm"
             onClick={() => setSelectedDevice(null)}>
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-slate-200"
            onClick={(e) => e.stopPropagation()} 
          >
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl">
              <div className="flex items-center gap-2 text-slate-800 font-bold text-lg">
                <Database className="w-5 h-5 text-blue-600" />
                <span>장비 마스터 레코드 (DB 원본)</span>
              </div>
              <button 
                onClick={() => setSelectedDevice(null)}
                className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
                title="닫기"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-grow bg-slate-900 text-emerald-400 font-mono text-[13px] sm:text-sm leading-relaxed rounded-b-2xl shadow-inner scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800">
              <pre className="whitespace-pre-wrap break-all sm:break-normal">
                {JSON.stringify(selectedDevice, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
