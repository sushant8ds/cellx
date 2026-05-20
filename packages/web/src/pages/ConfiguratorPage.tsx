import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import SchemaManager from '../components/configurator/SchemaManager';
import FormulaBuilder from '../components/configurator/FormulaBuilder';
import AlertRuleConfig from '../components/configurator/AlertRuleConfig';
import ImporterUI from '../components/configurator/ImporterUI';
import ApiKeyManager from '../components/configurator/ApiKeyManager';
import AiChat from '../components/AiChat';

type Tab = 'schema' | 'formulas' | 'alerts' | 'import' | 'apikeys' | 'ai';

const TABS: { id: Tab; label: string }[] = [
  { id: 'ai', label: '🤖 AI Assistant' },
  { id: 'schema', label: 'Schema' },
  { id: 'formulas', label: 'Formulas' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'import', label: 'Import' },
  { id: 'apikeys', label: 'API Keys' },
];

export default function ConfiguratorPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>('ai');

  const tenantId = user?.tenantId ?? '';

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '16px 24px' }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#111827' }}>Configurator</h1>
      </div>

      {/* Tab bar */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px', display: 'flex', gap: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '12px 20px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #2563eb' : '2px solid transparent',
              background: 'none',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 600 : 400,
              color: activeTab === tab.id ? '#2563eb' : '#6b7280',
              fontSize: 14,
              transition: 'all 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 16px' }}>
        {activeTab === 'ai' && <AiChat tenantId={tenantId} />}
        {activeTab === 'schema' && <SchemaManager tenantId={tenantId} />}
        {activeTab === 'formulas' && <FormulaBuilder tenantId={tenantId} />}
        {activeTab === 'alerts' && <AlertRuleConfig tenantId={tenantId} />}
        {activeTab === 'import' && <ImporterUI tenantId={tenantId} />}
        {activeTab === 'apikeys' && <ApiKeyManager tenantId={tenantId} />}
      </div>
    </div>
  );
}
