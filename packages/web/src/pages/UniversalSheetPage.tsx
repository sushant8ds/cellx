import React, { useState } from 'react';
import { useAuth } from '../lib/auth';
import Grid from '../components/Grid';
import { DatasetManager, type FileCollection } from '../components/DatasetManager';
import AiChat from '../components/AiChat';

type Tab = 'sheet' | 'sources';

export default function UniversalSheetPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [activeTab, setActiveTab] = useState<Tab>('sheet');
  const [showAi, setShowAi] = useState(false);
  const [activeCollection, setActiveCollection] = useState<FileCollection | null>(null);

  function handleCollectionsChange(collections: FileCollection[]) {
    if (collections.length > 0) {
      // Auto-select the most recently connected dataset and snap back to the grid
      setActiveCollection(collections[0]);
      setActiveTab('sheet');
    }
  }

  // Scope the grid to the active collection by filtering on collection_id.
  // When no collection is selected the grid shows all records for the tenant.
  const gridFilters = activeCollection
    ? { collection_id: activeCollection.id }
    : undefined;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: 'calc(100vh - 56px)', // 56px = NavBar height
      background: '#fcfcfc',
      fontFamily: 'inherit',
    }}>
      {/* ------------------------------------------------------------------ */}
      {/* Toolbar                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        background: '#fff',
        borderBottom: '1px solid #e5e7eb',
        flexShrink: 0,
      }}>
        {/* Left: logo + tab switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 18, background: '#10b981', color: '#fff',
              padding: '3px 7px', borderRadius: 5, fontWeight: 700,
            }}>X</span>
            <span style={{ fontWeight: 600, fontSize: 15, color: '#111827' }}>CellX Canvas</span>
          </div>

          <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', padding: 3, borderRadius: 8 }}>
            {([
              { id: 'sheet', label: '📄 Worksheet' },
              { id: 'sources', label: '🔌 Data Sources' },
            ] as { id: Tab; label: string }[]).map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                style={{
                  padding: '5px 14px',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: activeTab === id ? 600 : 400,
                  background: activeTab === id ? '#fff' : 'transparent',
                  boxShadow: activeTab === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  cursor: 'pointer',
                  color: activeTab === id ? '#111827' : '#6b7280',
                  transition: 'all 0.15s',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Right: AI toggle */}
        <button
          onClick={() => setShowAi(v => !v)}
          style={{
            padding: '7px 14px',
            background: showAi ? '#1e40af' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span>🤖</span>
          {showAi ? 'Hide AI Co-Pilot' : 'Ask AI Co-Pilot'}
        </button>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main workspace                                                       */}
      {/* ------------------------------------------------------------------ */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

        {/* Primary canvas */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 12 }}>

          {/* Data Sources tab */}
          {activeTab === 'sources' && (
            <div style={{ maxWidth: 620, width: '100%', margin: '16px auto' }}>
              <DatasetManager
                tenantId={tenantId}
                onCollectionsChange={handleCollectionsChange}
              />
            </div>
          )}

          {/* Worksheet tab */}
          {activeTab === 'sheet' && (
            <div style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              background: '#fff',
              borderRadius: 10,
              boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              border: '1px solid #e5e7eb',
              overflow: 'hidden',
            }}>
              {/* Context bar */}
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '7px 14px',
                borderBottom: '1px solid #f3f4f6',
                background: '#fafafa',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 12, color: '#6b7280' }}>
                  {activeCollection
                    ? `🟢 ${activeCollection.name}`
                    : '✍️ All records — click any cell to edit'}
                </span>
                {activeCollection && (
                  <button
                    onClick={() => setActiveCollection(null)}
                    style={{
                      border: 'none', background: 'none',
                      color: '#9ca3af', fontSize: 12, cursor: 'pointer',
                    }}
                  >
                    Show all ×
                  </button>
                )}
              </div>

              {/* Grid fills remaining height */}
              <div style={{ flex: 1, overflow: 'hidden', padding: '0 4px 4px' }}>
                <Grid
                  tenantId={tenantId}
                  initialFilters={gridFilters}
                />
              </div>
            </div>
          )}
        </div>

        {/* AI sidebar */}
        {showAi && (
          <div style={{
            width: 360,
            borderLeft: '1px solid #e5e7eb',
            background: '#fff',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
            overflow: 'hidden',
          }}>
            <AiChat tenantId={tenantId} />
          </div>
        )}
      </div>
    </div>
  );
}
