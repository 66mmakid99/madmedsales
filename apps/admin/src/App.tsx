import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { Login } from './routes/Login';
import { useAuthStore } from './stores/auth';
import { AppLayout } from './components/layout/AppLayout';
import { InactivePage } from './components/layout/InactivePage';
import { HospitalList } from './components/hospitals/HospitalList';
import { HospitalDetail } from './components/hospitals/HospitalDetail';
import { CrawlManagement } from './routes/CrawlManagement';
import { CostManagement } from './routes/CostManagement';
import { NetworkList } from './components/networks/NetworkList';
import { NetworkDetail } from './components/networks/NetworkDetail';

export function App(): ReactNode {
  const session = useAuthStore((s) => s.session);

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
