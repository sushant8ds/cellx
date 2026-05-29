import React, { useState } from 'react';
import SolverWizard from '../components/SolverWizard';
import AssignmentMatrix from '../components/AssignmentMatrix';

type View = 'wizard' | 'matrix';

export default function ExamDutyPage() {
  const [view, setView] = useState<View>('wizard');
  const [nameField, setNameField] = useState<string | undefined>(undefined);

  return (
    <div style={{ padding: '24px 32px', maxWidth: 900, margin: '0 auto', fontFamily: 'inherit' }}>
      {/* Page header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
          🎓 Exam Duty Assignment
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>
          Automatically distribute invigilation duties across faculty based on experience tiers
        </p>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 2, background: '#f3f4f6', padding: 3, borderRadius: 8, marginBottom: 28, width: 'fit-content' }}>
        {([
          { id: 'wizard', label: '⚙️ Setup Wizard' },
          { id: 'matrix', label: '📋 Assignment Matrix' },
        ] as { id: View; label: string }[]).map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setView(id)}
            style={{
              padding: '7px 18px', border: 'none', borderRadius: 6, fontSize: 13,
              fontWeight: view === id ? 600 : 400,
              background: view === id ? '#fff' : 'transparent',
              boxShadow: view === id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
              cursor: 'pointer',
              color: view === id ? '#111827' : '#6b7280',
              transition: 'all 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      {view === 'wizard' && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb' }}>
          <SolverWizard
            onComplete={result => {
              // After wizard completes, switch to matrix view
              void result;
              setView('matrix');
            }}
            onCancel={() => setView('matrix')}
          />
        </div>
      )}

      {view === 'matrix' && (
        <div style={{ background: '#fff', borderRadius: 12, padding: 24, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', border: '1px solid #e5e7eb' }}>
          <AssignmentMatrix nameField={nameField} />
        </div>
      )}
    </div>
  );
}
