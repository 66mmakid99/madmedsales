import type { ReactNode } from 'react';
import { useState } from 'react';
import { useLeadActivities } from '../../hooks/use-leads';
import { useLeadEmails } from '../../hooks/use-lead-emails';
import { useLeadDemos } from '../../hooks/use-lead-demos';
import { AllActivityTab } from './tabs/AllActivityTab';
import { EmailTab } from './tabs/EmailTab';
import { NoteTab } from './tabs/NoteTab';
import { DemoTab } from './tabs/DemoTab';

type TabId = 'all' | 'email' | 'demo' | 'note';

interface Tab {
  id: TabId;
  label: string;
  count: number | null;
}

interface LeadCommunicationViewProps {
  leadId: string;
}

export function LeadCommunicationView({ leadId }: LeadCommunicationViewProps): ReactNode {
  const [activeTab, setActiveTab] = useState<TabId>('all');

  const activitiesApi = useLeadActivities(leadId);
  const emailsApi = useLeadEmails(leadId);
  const demosApi = useLeadDemos(leadId);

  const activities = activitiesApi.data ?? [];
  const emails = emailsApi.data?.emails ?? [];
  const demos = demosApi.data?.demos ?? [];
  const noteCount = activities.filter((a) => a.activity_type === 'note_added').length;

  const tabs: Tab[] = [
    { id: 'all', label: '전체', count: activitiesApi.loading ? null : activities.length },
    { id: 'email', label: '이메일', count: emailsApi.loading ? null : emails.length },
    { id: 'demo', label: '데모', count: demosApi.loading ? null : demos.length },
    { id: 'note', label: '메모', count: activitiesApi.loading ? null : noteCount },
  ];

  return (
    <div className="rounded-lg border bg-white shadow-sm">
      {/* 탭바 */}
      <div className="flex border-b overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex shrink-0 items-center gap-1.5 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-blue-600 text-blue-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {tab.count !== null && tab.count > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${
                activeTab === tab.id ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 */}
      <div className="p-4">
        {activeTab === 'all' && (
          <AllActivityTab
            activities={activities}
            loading={activitiesApi.loading}
            error={activitiesApi.error}
          />
        )}
        {activeTab === 'email' && (
          <EmailTab
            emails={emails}
            loading={emailsApi.loading}
            error={emailsApi.error}
          />
        )}
        {activeTab === 'demo' && (
          <DemoTab
            demos={demos}
            loading={demosApi.loading}
            error={demosApi.error}
          />
        )}
        {activeTab === 'note' && (
          <NoteTab
            activities={activities}
            loading={activitiesApi.loading}
            error={activitiesApi.error}
          />
        )}
      </div>
    </div>
  );
}
