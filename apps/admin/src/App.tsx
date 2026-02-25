import { type ReactNode, useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { Login } from './routes/Login';
import { useAuthStore } from './stores/auth';
import { supabase } from './lib/supabase';
import { AppLayout } from './components/layout/AppLayout';
import { InactivePage } from './components/layout/InactivePage';
import { HospitalList } from './components/hospitals/HospitalList';
import { HospitalDetail } from './components/hospitals/HospitalDetail';
import { CrawlManagement } from './routes/CrawlManagement';
import { CostManagement } from './routes/CostManagement';
import { NetworkList } from './components/networks/NetworkList';
import { NetworkDetail } from './components/networks/NetworkDetail';
import { CrmDashboard } from './components/crm/CrmDashboard';
import { CrmHospitalList } from './components/crm/hospitals/CrmHospitalList';
import { CrmHospitalDetail } from './components/crm/hospitals/CrmHospitalDetail';
import { CrmProductList } from './components/crm/products/CrmProductList';

export function App(): ReactNode {
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setReady(true);
    });
  }, [setSession]);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <div className="flex items-center gap-2">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" />
          <span className="text-sm text-gray-400">로딩 중...</span>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" /> : <Login />} />
        {session ? (
          <Route element={<AppLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/hospitals" element={<HospitalList />} />
            <Route path="/hospitals/:id" element={<HospitalDetail />} />
            <Route path="/networks" element={<NetworkList />} />
            <Route path="/networks/:id" element={<NetworkDetail />} />
            <Route path="/crawls" element={<CrawlManagement />} />
            <Route path="/costs" element={<CostManagement />} />
            {/* CRM */}
            <Route path="/crm" element={<CrmDashboard />} />
            <Route path="/crm/hospitals" element={<CrmHospitalList />} />
            <Route path="/crm/hospitals/:id" element={<CrmHospitalDetail />} />
            <Route path="/crm/products" element={<CrmProductList />} />
            <Route path="/crm/equipment" element={<InactivePage title="장비/소모품" phase="CRM Phase 2" />} />
            <Route path="/crm/activities" element={<InactivePage title="활동 기록" phase="CRM Phase 2" />} />
            <Route path="/crm/reports" element={<InactivePage title="MADMEDCHECK 리포트" phase="CRM Phase 3" />} />
            {/* 비활성 메뉴 — Phase 3+ */}
            <Route path="/leads" element={<InactivePage title="리드 관리" />} />
            <Route path="/leads/:id" element={<InactivePage title="리드 상세" />} />
            <Route path="/emails" element={<InactivePage title="이메일 관리" phase="Phase 4" />} />
            <Route path="/emails/stats" element={<InactivePage title="이메일 통계" phase="Phase 4" />} />
            <Route path="/pipeline" element={<InactivePage title="파이프라인" />} />
            <Route path="/demos" element={<InactivePage title="데모 관리" phase="Phase 6" />} />
            <Route path="/demos/:id" element={<InactivePage title="데모 상세" phase="Phase 6" />} />
            <Route path="/reports" element={<InactivePage title="리포트" phase="Phase 5" />} />
            <Route path="/settings" element={<InactivePage title="설정" phase="Phase 7" />} />
            <Route path="*" element={<Navigate to="/dashboard" />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" />} />
        )}
      </Routes>
    </BrowserRouter>
  );
}
