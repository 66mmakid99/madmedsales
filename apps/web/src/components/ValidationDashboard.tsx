import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldAlert, Trash2, Database, AlertTriangle, RefreshCw, Layers, Cpu } from 'lucide-react';

export default function ValidationDashboard() {
  const [devices, setDevices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // 데이터 로드
  const fetchDevices = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('sales_medical_devices')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDevices(data || []);
    } catch (err: any) {
      console.error('검증 데이터 로딩 에러:', err.message);
      alert('데이터 베이스를 불러오는데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices();
  }, []);

  // 물리적 삭제 핸들러 (Optimistic Update)
  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`[경고] '${name}' 데이터를 DB에서 영구 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return;

    setDeletingId(id);
    try {
      // 1. UI 선반영 (Optimistic Update)
      setDevices(prev => prev.filter(d => d.id !== id));

      // 2. 실제 DB 삭제
      const { error } = await supabase
        .from('sales_medical_devices')
        .delete()
        .eq('id', id);

      if (error) {
        throw error;
      }
    } catch (err: any) {
      console.error('삭제 에러:', err.message);
      alert(`삭제 실패: ${err.message}`);
      // 실패 시 롤백 로직이 들어가면 더 좋습니다.
      fetchDevices();
    } finally {
      setDeletingId(null);
    }
  };

  // ✅ 오염도 계산 로직
  const { totalCount, dirtyDevices, healthScore } = useMemo(() => {
    const totalCount = devices.length;
    if (totalCount === 0) return { totalCount: 0, dirtyDevices: [], healthScore: 0 };

    const dirtyList = devices.filter((d) => {
      const name = d.name || d.model_name || d.device_name || '';
      const manufacturer = d.manufacturer || d.company;
      
      const isNameMissing = !name || name.trim().length < 3;
      const isMfgMissing = !manufacturer || manufacturer.trim() === '';
      const isNoise = name.includes('미분류') || name.includes('error');

      // 오염 조건: 이름이 3자 미만이거나, 제조사가 없거나, 노이즈 텍스트
      return isNameMissing || isMfgMissing || isNoise;
    });

    const healthRatio = ((totalCount - dirtyList.length) / totalCount) * 100;

    return { 
      totalCount, 
      dirtyDevices: dirtyList, 
      healthScore: healthRatio.toFixed(1)
    };
  }, [devices]);

  return (
    <div className="space-y-8">
      {/* 대시보드 상단 메트릭 요약 (Overview) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-50 text-blue-600 rounded-lg"><Database className="w-5 h-5" /></div>
            <h3 className="text-slate-600 font-medium">전체 장비 레코드</h3>
          </div>
          <p className="text-4xl font-extrabold text-slate-900">{totalCount.toLocaleString()}<span className="text-lg text-slate-500 font-normal ml-1">건</span></p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-lg"><ShieldAlert className="w-5 h-5" /></div>
            <h3 className="text-slate-600 font-medium">오염(에러) 레코드</h3>
          </div>
          <p className="text-4xl font-extrabold text-rose-600">
            {loading ? '-' : dirtyDevices.length.toLocaleString()}
            <span className="text-lg text-slate-500 font-normal ml-1">건</span>
          </p>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col justify-center">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-slate-600 font-medium">전체 데이터 건강도</h3>
            <span className={`text-sm font-bold px-2 py-1 rounded-full ${Number(healthScore) > 90 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {loading ? '-' : `${healthScore}% 정상`}
            </span>
          </div>
          
          <div className="w-full bg-slate-100 rounded-full h-4 mt-2 overflow-hidden border border-slate-200">
            <div 
              className={`h-4 rounded-full transition-all duration-1000 ${Number(healthScore) > 90 ? 'bg-emerald-500' : Number(healthScore) > 70 ? 'bg-amber-400' : 'bg-rose-500'}`} 
              style={{ width: `${loading ? 0 : healthScore}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* 요주의 데이터 패널 */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-6 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-6 h-6 text-rose-500" />
            <h2 className="text-xl font-bold text-slate-900">요주의 데이터 패널 (Attention Required)</h2>
          </div>
          <button 
            onClick={fetchDevices} 
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-lg hover:bg-slate-50 transition-colors text-sm disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
        </div>

        <div className="p-6 bg-slate-50/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-500">
              <RefreshCw className="w-8 h-8 animate-spin mb-4 text-slate-400" />
              <p>데이터베이스 스캔 중...</p>
            </div>
          ) : dirtyDevices.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-16 text-center border-2 border-dashed border-emerald-200 bg-emerald-50 rounded-xl">
              <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
                <span className="text-3xl">🎉</span>
              </div>
              <h3 className="text-xl font-bold text-emerald-800 mb-2">축하합니다! 완벽히 정규화되었습니다.</h3>
              <p className="text-emerald-600">현재 DB에 오염되거나 제조사가 누락된 에러 데이터가 0건입니다.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {dirtyDevices.map((device) => {
                const displayName = device.name || device.model_name || device.device_name || '이름 없음';
                const mfg = device.manufacturer || device.company;
                const isMfgMissing = !mfg || mfg.trim() === '';
                
                return (
                  <div key={device.id} className="bg-white border border-rose-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative group">
                    {/* 카드 상단 배지 (오류 유형) */}
                    <div className="absolute top-4 right-4 flex gap-1">
                      {isMfgMissing && <span className="bg-rose-100 text-rose-700 text-xs font-bold px-2 py-1 rounded">제조사 누락</span>}
                      {displayName.length < 3 && <span className="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-1 rounded">이름 노이즈</span>}
                    </div>

                    <div className="pr-20">
                      <h4 className="font-bold text-lg text-slate-900 mb-1 truncate" title={displayName}>{displayName}</h4>
                      <p className="text-sm text-slate-500 mb-4 flex items-center gap-1">
                        <Layers className="w-3.5 h-3.5" />
                        {isMfgMissing ? <span className="text-rose-500 font-medium">Unknown Manufacturer</span> : mfg}
                      </p>
                    </div>

                    <div className="text-xs text-slate-400 mb-4 line-clamp-2 bg-slate-50 p-2 rounded">
                      {device.raw_text || device.description || "설명 텍스트가 없습니다."}
                    </div>

                    {/* 액션 버튼 */}
                    <div className="flex justify-between items-center mt-auto pt-4 border-t border-slate-100">
                      <span className="text-xs text-slate-400 font-mono" title={device.id}>ID: {...device.id.substring(0,8)}</span>
                      <button
                        onClick={() => handleDelete(device.id, displayName)}
                        disabled={deletingId === device.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white rounded-lg transition-colors text-sm font-semibold disabled:opacity-50"
                      >
                        {deletingId === device.id ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        강제 삭제
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
