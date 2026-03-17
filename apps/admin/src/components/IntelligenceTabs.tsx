// C:\medcode\madmedsales\apps\web\src\components\IntelligenceTabs.tsx
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase'; // 이 경로가 없으면 에러가 날 수 있으니 주의!

export default function IntelligenceTabs() {
    const [devices, setDevices] = useState<any[]>([]);

    useEffect(() => {
        async function loadData() {
            // 사장님의 실제 테이블 이름
            const { data, error } = await supabase.from('sales_medical_devices').select('*');
            if (error) console.error('DB 에러:', error.message);
            if (data) setDevices(data);
        }
        loadData();
    }, []);

    return (
        <div className="p-6 bg-white rounded-xl shadow-lg border border-gray-100">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">의료기기 DB 현황</h2>
            <div className="grid gap-4">
                {devices.length > 0 ? (
                    devices.map((d) => (
                        <div key={d.id} className="p-4 border rounded-lg hover:bg-blue-50 transition-colors">
                            <div className="font-bold text-blue-700 text-lg">{d.model_name}</div>
                            <div className="text-gray-600">제조사: {d.manufacturer}</div>
                        </div>
                    ))
                ) : (
                    <p className="text-gray-400 animate-pulse">데이터를 불러오는 중입니다...</p>
                )}
            </div>
        </div>
    );
}