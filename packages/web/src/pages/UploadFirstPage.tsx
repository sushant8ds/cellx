import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// Types (mirroring smart-suggestions.ts)
// ---------------------------------------------------------------------------

interface SuggestionQuestion {
  id: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'multiselect' | 'toggle';
  placeholder?: string;
  options?: string[];
  defaultValue?: string | number | boolean;
  required: boolean;
}

interface DomainSuggestion {
  id: string;
  icon: string;
  title: string;
  description: string;
  questions: SuggestionQuestion[];
  primaryAction: 'setup_solver_problem' | 'setup_tracker' | 'setup_alerts';
}

interface SmartSuggestionsResult {
  primary: DomainSuggestion;
  alternatives: DomainSuggestion[];
  confidence: number;
}

interface DataProfile {
  filename: string;
  rowCount: number;
  columns: Array<{ name: string; inferredType: string; sampleValues: string[] }>;
}

type Step = 'upload' | 'analyzing' | 'suggest' | 'questions' | 'building' | 'done';

interface ChatChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProgressBar({ step }: { step: Step }) {
  const steps: Step[] = ['upload', 'analyzing', 'suggest', 'questions', 'building', 'done'];
  const idx = steps.indexOf(step);
  const labels = ['Upload', 'Analyzing', 'Choose Goal', 'Configure', 'Building', 'Done'];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 40 }}>
      {labels.map((label, i) => {
        const active = i === idx;
        const done = i < idx;
        return (
          <React.Fragment key={label}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: done ? '#10b981' : active ? '#2563eb' : '#e5e7eb',
                color: done || active ? '#fff' : '#9ca3af',
                fontSize: 12, fontWeight: 600, transition: 'all 0.3s',
              }}>
                {done ? '✓' : i + 1}
              </div>
              <span style={{ fontSize: 10, color: active ? '#2563eb' : done ? '#10b981' : '#9ca3af', fontWeight: active ? 600 : 400, whiteSpace: 'nowrap' }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? '#10b981' : '#e5e7eb', margin: '0 4px', marginBottom: 20, transition: 'background 0.3s' }} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function QuestionField({ q, value, onChange }: {
  q: SuggestionQuestion;
  value: string | number | boolean;
  onChange: (v: string | number | boolean) => void;
}) {
  const base: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db',
    fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box',
  };

  if (q.type === 'toggle') {
    return (
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
        <div
          onClick={() => onChange(!value)}
          style={{
            width: 40, height: 22, borderRadius: 11, position: 'relative', cursor: 'pointer',
            background: value ? '#2563eb' : '#d1d5db', transition: 'background 0.2s',
          }}
        >
          <div style={{
            position: 'absolute', top: 3, left: value ? 21 : 3,
            width: 16, height: 16, borderRadius: '50%', background: '#fff',
            transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
        <span style={{ fontSize: 14, color: '#374151' }}>{q.label}</span>
      </label>
    );
  }

  if (q.type === 'select' && q.options) {
    return (
      <select value={String(value)} onChange={e => onChange(e.target.value)} style={base}>
        {q.options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }

  return (
    <input
      type={q.type === 'number' ? 'number' : 'text'}
      value={String(value)}
      placeholder={q.placeholder}
      onChange={e => onChange(q.type === 'number' ? Number(e.target.value) : e.target.value)}
      style={base}
    />
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function UploadFirstPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const tenantId = user?.tenantId ?? '';

  const [step, setStep] = useState<Step>('upload');
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // After upload
  const [jobId, setJobId] = useState<string | null>(null);
  const [dataProfile, setDataProfile] = useState<DataProfile | null>(null);
  const [suggestions, setSuggestions] = useState<SmartSuggestionsResult | null>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState<DomainSuggestion | null>(null);

  // Question answers
  const [answers, setAnswers] = useState<Record<string, string | number | boolean>>({});

  // Building phase — streaming AI log
  const [buildLog, setBuildLog] = useState<Array<{ type: string; content: string; toolName?: string }>>([]);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [buildLog]);

  // ---------------------------------------------------------------------------
  // Step 1: Upload
  // ---------------------------------------------------------------------------

  async function handleFile(file: File) {
    setUploadError(null);
    setStep('analyzing');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const uploadRes = await api.post<{
        jobId: string;
        headers: string[];
        rowCount: number;
        dataProfile: DataProfile;
      }>(`/tenants/${tenantId}/imports`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const profile = uploadRes.data.dataProfile ?? {
        filename: file.name,
        rowCount: uploadRes.data.rowCount,
        columns: uploadRes.data.headers.map(h => ({ name: h, inferredType: 'text', sampleValues: [] })),
      };

      setJobId(uploadRes.data.jobId);
      setDataProfile(profile);

      // Get smart suggestions
      const suggestRes = await api.post<SmartSuggestionsResult>(
        `/tenants/${tenantId}/ai/analyze`,
        { dataProfile: profile },
      );
      setSuggestions(suggestRes.data);

      // Pre-fill answers with defaults
      const defaults: Record<string, string | number | boolean> = {};
      for (const q of suggestRes.data.primary.questions) {
        defaults[q.id] = q.defaultValue ?? (q.type === 'toggle' ? false : q.type === 'number' ? 0 : '');
      }
      setAnswers(defaults);
      setSelectedSuggestion(suggestRes.data.primary);
      setStep('suggest');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUploadError(msg ?? 'Upload failed. Check the file format and try again.');
      setStep('upload');
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Step 3: Select suggestion
  // ---------------------------------------------------------------------------

  function selectSuggestion(s: DomainSuggestion) {
    setSelectedSuggestion(s);
    const defaults: Record<string, string | number | boolean> = {};
    for (const q of s.questions) {
      defaults[q.id] = q.defaultValue ?? (q.type === 'toggle' ? false : q.type === 'number' ? 0 : '');
    }
    setAnswers(defaults);
    setStep('questions');
  }

  // ---------------------------------------------------------------------------
  // Step 5: Build — stream AI setup
  // ---------------------------------------------------------------------------

  async function runBuild() {
    if (!selectedSuggestion || !dataProfile) return;
    setStep('building');
    setBuildLog([]);
    setBuildError(null);

    // Build a natural language message that includes all the answers
    const answerSummary = selectedSuggestion.questions
      .map(q => `${q.label}: ${answers[q.id]}`)
      .join('\n');

    const message = `I've uploaded "${dataProfile.filename}" with ${dataProfile.rowCount} rows.
I want to: ${selectedSuggestion.title}
${selectedSuggestion.description}

Here are my settings:
${answerSummary}

Please set everything up automatically. Create all the necessary columns, formulas, and rules. Then confirm what you built.`;

    try {
      const response = await fetch(`/tenants/${tenantId}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('udcp_token') ?? ''}`,
        },
        body: JSON.stringify({ message, sessionId, dataProfile }),
      });

      const newSid = response.headers.get('X-Session-Id');
      if (newSid) setSessionId(newSid);

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const chunk = JSON.parse(line.slice(6)) as ChatChunk;
              setBuildLog(prev => [...prev, chunk]);
              if (chunk.type === 'error') setBuildError(chunk.content);
            } catch { /* ignore */ }
          }
          if (line.startsWith('event: done')) {
            setStep('done');
          }
        }
      }
      setStep('done');
    } catch (err) {
      setBuildError(String(err));
      setStep('building'); // stay on building so user sees the error
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{
      minHeight: '100vh', background: 'linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      padding: '40px 20px', fontFamily: 'inherit',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 28, background: '#10b981', color: '#fff', padding: '6px 10px', borderRadius: 8, fontWeight: 700 }}>X</span>
          <span style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>CellX</span>
        </div>
        <p style={{ fontSize: 15, color: '#6b7280', margin: 0 }}>
          Upload your data — AI does the rest
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 640 }}>
        <ProgressBar step={step} />

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8, textAlign: 'center' }}>
              What data are you working with?
            </h2>
            <p style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 28 }}>
              Upload a spreadsheet and AI will understand it instantly
            </p>

            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              style={{
                border: `2px dashed ${isDragging ? '#2563eb' : '#d1d5db'}`,
                borderRadius: 12, padding: '48px 24px', textAlign: 'center',
                background: isDragging ? '#eff6ff' : '#f9fafb',
                transition: 'all 0.15s', cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                Drop your file here
              </div>
              <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>
                CSV or Excel (.xlsx) — faculty lists, inventory, patient records, anything
              </div>
              <label style={{
                display: 'inline-block', padding: '10px 24px',
                background: '#2563eb', color: '#fff', borderRadius: 8,
                cursor: 'pointer', fontSize: 14, fontWeight: 500,
              }}>
                Choose File
                <input type="file" accept=".csv,.xlsx" style={{ display: 'none' }}
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
              </label>
            </div>

            {uploadError && (
              <div style={{ marginTop: 16, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
                {uploadError}
              </div>
            )}

            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <button
                onClick={() => navigate('/')}
                style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', textDecoration: 'underline' }}
              >
                Skip — start with a blank canvas
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Analyzing ── */}
        {step === 'analyzing' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 48, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16, animation: 'spin 1s linear infinite' }}>🔍</div>
            <h2 style={{ fontSize: 18, fontWeight: 600, color: '#111827', marginBottom: 8 }}>Analyzing your data…</h2>
            <p style={{ fontSize: 14, color: '#6b7280' }}>Reading columns, detecting data types, understanding context</p>
            <div style={{ marginTop: 24, display: 'flex', gap: 6, justifyContent: 'center' }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 8, height: 8, borderRadius: '50%', background: '#2563eb',
                  opacity: 0.3, animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}

        {/* ── Step 3: Suggest ── */}
        {step === 'suggest' && suggestions && dataProfile && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            {/* Data summary */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '12px 16px', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>✅</span>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#166534' }}>{dataProfile.filename}</div>
                <div style={{ fontSize: 12, color: '#4b5563' }}>
                  {dataProfile.rowCount.toLocaleString()} rows · {dataProfile.columns.length} columns: {dataProfile.columns.slice(0, 4).map(c => c.name).join(', ')}{dataProfile.columns.length > 4 ? '…' : ''}
                </div>
              </div>
            </div>

            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
              What would you like to do with this data?
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              AI detected the best match — pick one or choose something else
            </p>

            {/* Primary suggestion */}
            <div
              onClick={() => selectSuggestion(suggestions.primary)}
              style={{
                border: '2px solid #2563eb', borderRadius: 10, padding: '16px 20px',
                cursor: 'pointer', marginBottom: 12, background: '#eff6ff',
                display: 'flex', alignItems: 'flex-start', gap: 14,
              }}
            >
              <span style={{ fontSize: 28, flexShrink: 0 }}>{suggestions.primary.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: '#1e40af' }}>{suggestions.primary.title}</span>
                  <span style={{ fontSize: 10, background: '#2563eb', color: '#fff', padding: '2px 6px', borderRadius: 10, fontWeight: 600 }}>BEST MATCH</span>
                </div>
                <div style={{ fontSize: 13, color: '#374151' }}>{suggestions.primary.description}</div>
              </div>
              <span style={{ fontSize: 18, color: '#2563eb', flexShrink: 0 }}>→</span>
            </div>

            {/* Alternatives */}
            {suggestions.alternatives.map(alt => (
              <div
                key={alt.id}
                onClick={() => selectSuggestion(alt)}
                style={{
                  border: '1px solid #e5e7eb', borderRadius: 10, padding: '14px 18px',
                  cursor: 'pointer', marginBottom: 10, background: '#fff',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'border-color 0.15s',
                }}
                onMouseOver={e => (e.currentTarget.style.borderColor = '#93c5fd')}
                onMouseOut={e => (e.currentTarget.style.borderColor = '#e5e7eb')}
              >
                <span style={{ fontSize: 22 }}>{alt.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#111827' }}>{alt.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{alt.description}</div>
                </div>
                <span style={{ fontSize: 16, color: '#9ca3af' }}>→</span>
              </div>
            ))}

            {/* Custom option */}
            <div
              onClick={() => selectSuggestion({
                id: 'custom',
                icon: '✏️',
                title: 'Something else',
                description: 'Describe what you want to build',
                questions: [{ id: 'goal', label: 'What do you want to build?', type: 'text', placeholder: 'e.g. Track equipment maintenance schedules', required: true }],
                primaryAction: 'setup_tracker',
              })}
              style={{
                border: '1px dashed #d1d5db', borderRadius: 10, padding: '12px 18px',
                cursor: 'pointer', background: '#f9fafb',
                display: 'flex', alignItems: 'center', gap: 12,
              }}
            >
              <span style={{ fontSize: 20 }}>✏️</span>
              <span style={{ fontSize: 13, color: '#6b7280' }}>Something else — describe what you want</span>
            </div>
          </div>
        )}

        {/* ── Step 4: Questions ── */}
        {step === 'questions' && selectedSuggestion && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
              <span style={{ fontSize: 28 }}>{selectedSuggestion.icon}</span>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', margin: 0 }}>{selectedSuggestion.title}</h2>
                <p style={{ fontSize: 13, color: '#6b7280', margin: '2px 0 0' }}>Just a few quick settings</p>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {selectedSuggestion.questions.map(q => (
                <div key={q.id}>
                  {q.type !== 'toggle' && (
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                      {q.label}
                      {q.required && <span style={{ color: '#ef4444' }}> *</span>}
                    </label>
                  )}
                  <QuestionField
                    q={q}
                    value={answers[q.id] ?? q.defaultValue ?? ''}
                    onChange={v => setAnswers(prev => ({ ...prev, [q.id]: v }))}
                  />
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 28 }}>
              <button
                onClick={() => setStep('suggest')}
                style={{ padding: '10px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14, color: '#374151' }}
              >
                ← Back
              </button>
              <button
                onClick={runBuild}
                style={{ flex: 1, padding: '10px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                🚀 Build My System
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Building ── */}
        {step === 'building' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 32, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
              🤖 AI is building your system…
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>
              Creating columns, formulas, and rules automatically
            </p>

            <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, maxHeight: 280, overflowY: 'auto', fontFamily: 'monospace', fontSize: 12 }}>
              {buildLog.map((entry, i) => (
                <div key={i} style={{ marginBottom: 6, color: entry.type === 'error' ? '#f87171' : entry.type === 'tool_call' ? '#34d399' : entry.type === 'tool_result' ? '#60a5fa' : '#e2e8f0' }}>
                  {entry.type === 'tool_call' && <span style={{ color: '#fbbf24' }}>⚙ {entry.toolName} </span>}
                  {entry.type === 'tool_result' && <span style={{ color: '#34d399' }}>✓ </span>}
                  {entry.content}
                </div>
              ))}
              {buildLog.length === 0 && (
                <div style={{ color: '#64748b' }}>Starting…</div>
              )}
              <div ref={logEndRef} />
            </div>

            {buildError && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
                {buildError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 6: Done ── */}
        {step === 'done' && (
          <div style={{ background: '#fff', borderRadius: 16, padding: 40, boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
            <div style={{ fontSize: 56, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              Your system is ready!
            </h2>
            <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 28 }}>
              {selectedSuggestion?.title} has been set up automatically.
              Your data is in the grid, ready to use.
            </p>

            {/* Summary of what was built */}
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '14px 18px', marginBottom: 28, textAlign: 'left' }}>
              {buildLog
                .filter(e => e.type === 'tool_result')
                .slice(0, 6)
                .map((e, i) => (
                  <div key={i} style={{ fontSize: 13, color: '#166534', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>✓</span> {e.content}
                  </div>
                ))}
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button
                onClick={() => navigate('/')}
                style={{ padding: '12px 28px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 15, fontWeight: 600 }}
              >
                View My Data →
              </button>
              <button
                onClick={() => { setStep('upload'); setDataProfile(null); setSuggestions(null); setBuildLog([]); }}
                style={{ padding: '12px 20px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 8, cursor: 'pointer', fontSize: 14, color: '#374151' }}
              >
                Upload Another File
              </button>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
      `}</style>
    </div>
  );
}
