import React, { useState, useMemo } from 'react';
import { useAuth } from '../lib/auth';
import { useSchema } from '../hooks/useRecords';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WizardAnswers {
  resourceNameField: string;
  experienceField: string;
  classrooms: number;
  slotsPerDay: number;
  examDays: number;
  juniorMax: number;
  midMax: number;
  seniorMax: number;
  noSimultaneous: boolean;
  includeSupervisor: boolean;
  reliefCount: number;
}

interface UtilizationTier {
  count: number;
  avgDuties: number;
}

interface WizardResult {
  summary: {
    totalFaculty: number;
    totalSlots: number;
    assigned: number;
    conflicts: number;
    utilizationByTier: Record<string, UtilizationTier>;
  };
  solverResult: {
    assignments: Array<{ resourceId: string; slotId: string; isOverride: boolean }>;
    conflicts: Array<{ slotId: string; reason: string }>;
  };
}

type WizardStep = 1 | 2 | 3 | 4 | 5;

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEP_LABELS = [
  'Who to assign',
  'Where & when',
  'Duty rules',
  'Special roles',
  'Review & run',
];

function StepDots({ current }: { current: WizardStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28 }}>
      {STEP_LABELS.map((label, i) => {
        const n = (i + 1) as WizardStep;
        const active = current === n;
        const done = current > n;
        return (
          <React.Fragment key={n}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 26, height: 26, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? '#10b981' : active ? '#2563eb' : '#e5e7eb',
                color: done || active ? '#fff' : '#9ca3af',
                fontSize: 11, fontWeight: 700, transition: 'all 0.2s',
              }}>
                {done ? '✓' : n}
              </div>
              <span style={{ fontSize: 10, color: active ? '#2563eb' : done ? '#10b981' : '#9ca3af', whiteSpace: 'nowrap', fontWeight: active ? 600 : 400 }}>
                {label}
              </span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? '#10b981' : '#e5e7eb', margin: '0 4px', marginBottom: 20, transition: 'background 0.2s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reusable field components
// ---------------------------------------------------------------------------

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4 }}>{label}</label>
      {hint && <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 6px' }}>{hint}</p>}
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 12px', border: '1px solid #d1d5db',
  borderRadius: 6, fontSize: 14, boxSizing: 'border-box', outline: 'none',
};

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 12 }}>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 40, height: 22, borderRadius: 11, position: 'relative',
          background: value ? '#2563eb' : '#d1d5db', transition: 'background 0.2s', cursor: 'pointer', flexShrink: 0,
        }}
      >
        <div style={{
          position: 'absolute', top: 3, left: value ? 21 : 3,
          width: 16, height: 16, borderRadius: '50%', background: '#fff',
          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </div>
      <span style={{ fontSize: 14, color: '#374151' }}>{label}</span>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface Props {
  onComplete?: (result: WizardResult) => void;
  onCancel?: () => void;
}

export default function SolverWizard({ onComplete, onCancel }: Props) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';
  const { data: schemaFields } = useSchema(tenantId);

  const [step, setStep] = useState<WizardStep>(1);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WizardResult | null>(null);

  const [answers, setAnswers] = useState<WizardAnswers>({
    resourceNameField: '',
    experienceField: '',
    classrooms: 10,
    slotsPerDay: 3,
    examDays: 4,
    juniorMax: 5,
    midMax: 3,
    seniorMax: 1,
    noSimultaneous: true,
    includeSupervisor: false,
    reliefCount: 0,
  });

  const set = (key: keyof WizardAnswers, value: WizardAnswers[keyof WizardAnswers]) =>
    setAnswers(prev => ({ ...prev, [key]: value }));

  const fieldNames = useMemo(() => schemaFields?.map(f => f.name) ?? [], [schemaFields]);

  // Estimated assignments preview
  const estimatedSlots = answers.classrooms * answers.slotsPerDay * answers.examDays;

  // ---------------------------------------------------------------------------
  // Run
  // ---------------------------------------------------------------------------

  async function runWizard() {
    setIsRunning(true);
    setError(null);
    try {
      const res = await api.post<WizardResult>(`/tenants/${tenantId}/solver/wizard`, answers);
      setResult(res.data);
      setStep(5);
      onComplete?.(res.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Solver failed. Check your data and try again.');
    } finally {
      setIsRunning(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render steps
  // ---------------------------------------------------------------------------

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', fontFamily: 'inherit' }}>
      <StepDots current={step} />

      {/* ── Step 1: Who ── */}
      {step === 1 && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>Who are you assigning?</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
            Select the columns from your uploaded data that identify each person
          </p>

          <Field label="Name column" hint="Which column contains the faculty member's name?">
            <select value={answers.resourceNameField} onChange={e => set('resourceNameField', e.target.value)} style={inputStyle}>
              <option value="">Select a column…</option>
              {fieldNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>

          <Field label="Experience / Rank column (optional)" hint="Used to automatically assign duty limits by seniority. Leave blank to apply equal limits.">
            <select value={answers.experienceField} onChange={e => set('experienceField', e.target.value)} style={inputStyle}>
              <option value="">None — apply equal limits to everyone</option>
              {fieldNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              onClick={() => setStep(2)}
              disabled={!answers.resourceNameField}
              style={{ padding: '10px 24px', background: answers.resourceNameField ? '#2563eb' : '#93c5fd', color: '#fff', border: 'none', borderRadius: 8, cursor: answers.resourceNameField ? 'pointer' : 'not-allowed', fontSize: 14, fontWeight: 600 }}
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Where & When ── */}
      {step === 2 && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>Where and when?</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
            Define the exam schedule structure
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
            <Field label="Exam rooms">
              <input type="number" min={1} max={200} value={answers.classrooms} onChange={e => set('classrooms', Number(e.target.value))} style={inputStyle} />
            </Field>
            <Field label="Slots per day">
              <select value={answers.slotsPerDay} onChange={e => set('slotsPerDay', Number(e.target.value))} style={inputStyle}>
                <option value={1}>1 (Morning)</option>
                <option value={2}>2 (AM + PM)</option>
                <option value={3}>3 (AM + PM + Eve)</option>
                <option value={4}>4 slots</option>
              </select>
            </Field>
            <Field label="Exam days">
              <input type="number" min={1} max={30} value={answers.examDays} onChange={e => set('examDays', Number(e.target.value))} style={inputStyle} />
            </Field>
          </div>

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '12px 16px', fontSize: 13, color: '#1e40af' }}>
            📊 This will create <strong>{estimatedSlots.toLocaleString()}</strong> exam slots
            ({answers.classrooms} rooms × {answers.slotsPerDay} slots/day × {answers.examDays} days)
          </div>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 24 }}>
            <button onClick={() => setStep(1)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>← Back</button>
            <button onClick={() => setStep(3)} style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Next →</button>
          </div>
        </div>
      )}

      {/* ── Step 3: Duty rules ── */}
      {step === 3 && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>How should duties be distributed?</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
            {answers.experienceField
              ? `Set the maximum number of duties per experience tier`
              : 'Set the maximum duties per person (no experience column selected)'}
          </p>

          {answers.experienceField ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
              <Field label="🟢 Junior (0–5 yrs)" hint="Max duties">
                <input type="number" min={1} max={20} value={answers.juniorMax} onChange={e => set('juniorMax', Number(e.target.value))} style={inputStyle} />
              </Field>
              <Field label="🟡 Mid-level (5–15 yrs)" hint="Max duties">
                <input type="number" min={1} max={20} value={answers.midMax} onChange={e => set('midMax', Number(e.target.value))} style={inputStyle} />
              </Field>
              <Field label="🔴 Senior (15+ yrs)" hint="Max duties">
                <input type="number" min={1} max={20} value={answers.seniorMax} onChange={e => set('seniorMax', Number(e.target.value))} style={inputStyle} />
              </Field>
            </div>
          ) : (
            <Field label="Max duties per person">
              <input type="number" min={1} max={20} value={answers.juniorMax} onChange={e => { set('juniorMax', Number(e.target.value)); set('midMax', Number(e.target.value)); set('seniorMax', Number(e.target.value)); }} style={{ ...inputStyle, maxWidth: 120 }} />
            </Field>
          )}

          <Toggle value={answers.noSimultaneous} onChange={v => set('noSimultaneous', v)} label="No person in two rooms at the same time" />

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setStep(2)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>← Back</button>
            <button onClick={() => setStep(4)} style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Next →</button>
          </div>
        </div>
      )}

      {/* ── Step 4: Special roles ── */}
      {step === 4 && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>Any special roles?</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
            Optional — leave all off if not needed
          </p>

          <Toggle value={answers.includeSupervisor} onChange={v => set('includeSupervisor', v)} label="Include a supervisor role (1 senior faculty per room)" />

          <Field label="Relief / standby faculty" hint="Number of faculty kept on standby (not assigned to rooms)">
            <input type="number" min={0} max={20} value={answers.reliefCount} onChange={e => set('reliefCount', Number(e.target.value))} style={{ ...inputStyle, maxWidth: 100 }} />
          </Field>

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setStep(3)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>← Back</button>
            <button onClick={() => setStep(5)} style={{ padding: '10px 24px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Review →</button>
          </div>
        </div>
      )}

      {/* ── Step 5: Review & Run ── */}
      {step === 5 && !result && (
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>Review & Generate</h2>
          <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>Here's what will be created:</p>

          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 20 }}>
            {[
              ['People column', answers.resourceNameField],
              ['Experience column', answers.experienceField || 'Not set (equal limits)'],
              ['Exam rooms', String(answers.classrooms)],
              ['Slots per day', String(answers.slotsPerDay)],
              ['Exam days', String(answers.examDays)],
              ['Total slots', String(estimatedSlots)],
              ['Junior max duties', String(answers.juniorMax)],
              ['Mid-level max duties', String(answers.midMax)],
              ['Senior max duties', String(answers.seniorMax)],
              ['No simultaneous', answers.noSimultaneous ? 'Yes' : 'No'],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f3f4f6', fontSize: 13 }}>
                <span style={{ color: '#6b7280' }}>{label}</span>
                <span style={{ fontWeight: 500, color: '#111827' }}>{value}</span>
              </div>
            ))}
          </div>

          {error && (
            <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
            <button onClick={() => setStep(4)} style={{ padding: '10px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>← Back</button>
            <button
              onClick={runWizard}
              disabled={isRunning}
              style={{ padding: '10px 28px', background: isRunning ? '#93c5fd' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: isRunning ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 600 }}
            >
              {isRunning ? '⏳ Generating…' : '🚀 Generate Assignments'}
            </button>
          </div>
        </div>
      )}

      {/* ── Results ── */}
      {result && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🎉</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Assignments Generated!</h2>
            <p style={{ fontSize: 14, color: '#6b7280' }}>
              {result.summary.assigned} of {result.summary.totalSlots} slots filled
              {result.summary.conflicts > 0 && ` · ${result.summary.conflicts} conflicts`}
            </p>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Faculty', value: result.summary.totalFaculty, color: '#2563eb' },
              { label: 'Assigned', value: result.summary.assigned, color: '#10b981' },
              { label: 'Conflicts', value: result.summary.conflicts, color: result.summary.conflicts > 0 ? '#dc2626' : '#9ca3af' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: 14, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label}</div>
              </div>
            ))}
          </div>

          {/* Tier breakdown */}
          {Object.keys(result.summary.utilizationByTier).length > 0 && (
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Duty distribution by tier</div>
              {Object.entries(result.summary.utilizationByTier).map(([tier, { count, avgDuties }]) => (
                <div key={tier} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: '#374151' }}>{tier} ({count} faculty)</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#2563eb' }}>{avgDuties} avg duties</span>
                </div>
              ))}
            </div>
          )}

          {result.summary.conflicts > 0 && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626', marginBottom: 16 }}>
              ⚠️ {result.summary.conflicts} slot{result.summary.conflicts > 1 ? 's' : ''} could not be filled.
              This usually means there aren't enough eligible faculty. You can manually override assignments in the grid.
            </div>
          )}

          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => { setResult(null); setStep(1); setAnswers({ resourceNameField: '', experienceField: '', classrooms: 10, slotsPerDay: 3, examDays: 4, juniorMax: 5, midMax: 3, seniorMax: 1, noSimultaneous: true, includeSupervisor: false, reliefCount: 0 }); }}
              style={{ padding: '10px 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}
            >
              Run Again
            </button>
            {onCancel && (
              <button onClick={onCancel} style={{ padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                View Assignments →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
