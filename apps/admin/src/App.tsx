import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Dashboard } from './routes/Dashboard';
import { Login } from './routes/Login';
import { useAuthStore } from './stores/auth';
import { AppLayout } from './components/layout/AppLayout';
import { LeadList } from './components/leads/LeadList';
import { LeadDetail } from './components/leads/LeadDetail';
import { PipelineBoard } from './components/pipeline/PipelineBoard';
import { EmailList } from './components/emails/EmailList';
import { EmailStatsPage } from './components/emails/EmailStats';
import { DemoList } from './components/demos/DemoList';
import { DemoDetail } from './components/demos/DemoDetail';
import { HospitalList } from './components/hospitals/HospitalList';
import { HospitalDetail } from './components/hospitals/HospitalDetail';
import { CostManagement } from './routes/CostManagement';

function SettingsPlaceholder(): ReactNode {
  return (
    <div className="text-center text-gray-400">
      <h2 className="text-lg font-bold text-gray-900">설정</h2>
      <p className="mt-4">설정 페이지 준비 중</p>
    </div>
  );
}

export function App(): ReactNode {
  const session = useAuthStore((s) => s.session);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/" /> : <Login />} />
        {session ? (
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/leads" element={<LeadList />} />
            <Route path="/leads/:id" element={<LeadDetail />} />
            <Route path="/pipeline" element={<PipelineBoard />} />
            <Route path="/emails" element={<EmailList />} />
            <Route path="/emails/stats" element={<EmailStatsPage />} />
            <Route path="/demos" element={<DemoList />} />
            <Route path="/demos/:id" element={<DemoDetail />} />
            <Route path="/hospitals" element={<HospitalList />} />
            <Route path="/hospitals/:id" element={<HospitalDetail />} />
            <Route path="/costs" element={<CostManagement />} />
            <Route path="/settings" element={<SettingsPlaceholder />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Route>
        ) : (
          <Route path="*" element={<Navigate to="/login" />} />
        )}
      </Routes>
    </BrowserRouter>
  );
}
