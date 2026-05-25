import React, { useState, useCallback } from 'react';
import api from '../lib/api';
import { useAuth } from '../lib/auth';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ColumnMapping {
  facultyNameField: string;   // maps to resourceFieldId
  experienceField: string;    // used to build min/max_assignments constraint rules
  roomNameField: string;      // maps to slotFieldId
  roomCapacityField: string;  // maps to capacityFieldId
}

interface SolverSummary {
  totalSlots: number;
  assignedSlots: number;
  conflictSlots: number;
  resourceUtilization: Record<string, { assigned: number; min: number; max: number }>;
}

interface SolverResult {
  jobId: string;
  summary: SolverSummary;
  conflictCount: number;
}

interface Assignment {
  id: string;
  data: {
    resource_id: string;
    slot_id: string;
    item_ids: string[];
    is_override: boolean;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: 1 | 2 | 3 }) {
  const steps = ['1. Upload Spreadsheet', '2. Configure Constraints', '3. Export Schedules'];
  return (
    <div style={{ display: 'flex', gap: 0, marginBottom: 32, borderBottom: '1px solid #e5e7eb', paddingBottom: 0 }}>
      {steps.map((label, idx) => {
        const n = (idx + 1) as 1 | 2 | 3;
        const active = current === n;
        const done = current > n;
        return (
          <div key={n} style={{
            flex: 1,
            padding: '10px 0',
            textAlign: 'center',
            fontSize: 13,
            fontWeight: active ? 600 : 400,
            color: active ? '#2563eb' : done ? '#10b981' : '#9ca3af',
            borderBottom: active ? '2px solid #2563eb' : done ? '2px solid #10b981' : '2px solid transparent',
            transition: 'all 0.2s',
          }}>
            {done ? '✓ ' : ''}{label}
          </div>
        );
      })}
    </div>
  );
}

function SelectField({
  label, value, columns, onChange, required,
}: {
  label: string;
  value: string;
  columns: string[];
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, marginBottom: 4, color: '#4b5563', fontWeight: 500 }}>
        {label}{required && <span style={{ color: '#ef4444' }}> *</span>}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%', padding: '7px 10px', borderRadius: 6,
          border: `1px solid ${value ? '#10b981' : '#d1d5db'}`,
          fontSize: 13, background: '#fff', outline: 'none',
        }}
      >
        <option value="">Select column…</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function SolverPage() {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [solverError, setSolverError] = useState<string | null>(null);

  // Populated after upload — real column headers from the file
  const [columns, setColumns] = useState<string[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState<number>(0);
  const [fileName, setFileName] = useState<string>('');

  const [mapping, setMapping] = useState<ColumnMapping>({
    facultyNameField: '',
    experienceField: '',
    roomNameField: '',
    roomCapacityField: '',
  });

  const [result, setResult] = useState<SolverResult | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  // ---------------------------------------------------------------------------
  // Step 1: Upload file → get real headers back from the API
  // ---------------------------------------------------------------------------

  async function uploadFile(file: File) {
    setIsUploading(true);
    setUploadError(null);
    setFileName(file.name);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await api.post<{
        jobId: string;
        headers: string[];
        rowCount: number;
      }>(`/tenants/${tenantId}/imports`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setJobId(response.data.jobId);
      setColumns(response.data.headers);
      setRowCount(response.data.rowCount);
      setStep(2);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setUploadError(msg ?? 'Upload failed. Check the file format and try again.');
    } finally {
      setIsUploading(false);
    }
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  }

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------------------
  // Step 2: Run solver — maps ColumnMapping to the real API contract
  // ---------------------------------------------------------------------------

  async function runSolver() {
    if (!mapping.facultyNameField || !mapping.roomNameField || !mapping.roomCapacityField) {
      setSolverError('Please map Faculty Name, Room Name, and Room Capacity columns before running.');
      return;
    }

    setIsProcessing(true);
    setSolverError(null);

    try {
      // The solver router expects field IDs, but here we're using column header names
      // as field identifiers since the data was just uploaded and not yet schema-mapped.
      // The solver service uses these as keys into record.data, which matches how
      // processImport stores raw column values.
      const response = await api.post<SolverResult>(`/tenants/${tenantId}/solver/run`, {
        resourceFieldId: mapping.facultyNameField,
        slotFieldId: mapping.roomNameField,
        itemFieldId: mapping.experienceField || mapping.facultyNameField,
        capacityFieldId: mapping.roomCapacityField,
        priorityFieldId: '',
        constraintRuleIds: [],
      });

      setResult(response.data);

      // Fetch the generated assignments for the preview table
      const assignmentsRes = await api.get<Assignment[]>(`/tenants/${tenantId}/solver/assignments`);
      setAssignments(assignmentsRes.data);

      setStep(3);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSolverError(msg ?? 'Solver encountered a constraint conflict. Verify room capacity values.');
    } finally {
      setIsProcessing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Step 3: Export assignments as CSV (client-side, no extra endpoint needed)
  // ---------------------------------------------------------------------------

  function downloadCsv() {
    const header = 'Faculty ID,Room ID,Item IDs,Override\n';
    const rows = assignments.map(a =>
      `${a.data.resource_id},${a.data.slot_id},"${a.data.item_ids.join(';')}",${a.data.is_override}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'exam-duty-allocation.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const mappingComplete = mapping.facultyNameField && mapping.roomNameField && mapping.roomCapacityField;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: '0 auto', fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>
          Exam Duty Allocation
        </h1>
        <p style={{ fontSize: 14, color: '#6b7280' }}>
          Upload your faculty and room roster, map the columns, and let the engine distribute
          invigilation duties based on experience tiers.
        </p>
      </div>

      <StepIndicator current={step} />

      {/* ------------------------------------------------------------------ */}
      {/* Step 1: Upload                                                       */}
      {/* ------------------------------------------------------------------ */}
      {step === 1 && (
        <div>
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? '#2563eb' : '#d1d5db'}`,
              borderRadius: 12,
              padding: '48px 24px',
              textAlign: 'center',
              background: isDragging ? '#eff6ff' : '#f9fafb',
              transition: 'all 0.15s',
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 36, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              {isUploading ? 'Uploading…' : 'Drop your roster here, or click to browse'}
            </div>
            <div style={{ fontSize: 13, color: '#9ca3af', marginBottom: 20 }}>
              Accepts .xlsx and .csv — include faculty names, experience tiers, room IDs, and capacities
            </div>
            <label style={{
              display: 'inline-block',
              padding: '8px 20px',
              background: isUploading ? '#93c5fd' : '#2563eb',
              color: '#fff',
              borderRadius: 6,
              cursor: isUploading ? 'not-allowed' : 'pointer',
              fontSize: 13,
              fontWeight: 500,
            }}>
              {isUploading ? 'Uploading…' : 'Choose File'}
              <input
                type="file"
                accept=".csv,.xlsx"
                onChange={handleFileInput}
                disabled={isUploading}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          {uploadError && (
            <div style={{ marginTop: 16, padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
              {uploadError}
            </div>
          )}

          <div style={{ marginTop: 20, padding: 16, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, fontSize: 13, color: '#166534' }}>
            <strong>Tip:</strong> Your spreadsheet should have columns for faculty names, their experience level
            (e.g. "Junior", "Mid", "Senior"), room/venue names, and room capacity numbers.
            Column names can be anything — you'll map them in the next step.
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 2: Map columns + run                                           */}
      {/* ------------------------------------------------------------------ */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* File summary */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <span style={{ fontSize: 20 }}>✅</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#166534' }}>{fileName}</div>
              <div style={{ fontSize: 12, color: '#4b5563' }}>{rowCount.toLocaleString()} rows · {columns.length} columns detected</div>
            </div>
            <button
              onClick={() => { setStep(1); setColumns([]); setJobId(null); }}
              style={{ marginLeft: 'auto', fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Change file
            </button>
          </div>

          {/* Experience tier info */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', padding: 16, borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e40af', marginBottom: 10 }}>
              Invigilation Duty Rules
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {[
                { tier: 'Junior', duties: '5 duties', color: '#dc2626' },
                { tier: 'Mid-level', duties: '3–4 duties', color: '#d97706' },
                { tier: 'Senior', duties: '1–2 duties', color: '#16a34a' },
              ].map(({ tier, duties, color }) => (
                <div key={tier} style={{ textAlign: 'center', padding: '10px 8px', background: '#fff', borderRadius: 6, border: '1px solid #e0e7ff' }}>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{tier}</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color, marginTop: 2 }}>{duties}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Column mapping */}
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 14 }}>
              Map your spreadsheet columns
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <SelectField
                label="Faculty / Invigilator Name"
                value={mapping.facultyNameField}
                columns={columns}
                onChange={v => setMapping(m => ({ ...m, facultyNameField: v }))}
                required
              />
              <SelectField
                label="Experience / Rank"
                value={mapping.experienceField}
                columns={columns}
                onChange={v => setMapping(m => ({ ...m, experienceField: v }))}
              />
              <SelectField
                label="Room / Venue Name"
                value={mapping.roomNameField}
                columns={columns}
                onChange={v => setMapping(m => ({ ...m, roomNameField: v }))}
                required
              />
              <SelectField
                label="Room Capacity (number)"
                value={mapping.roomCapacityField}
                columns={columns}
                onChange={v => setMapping(m => ({ ...m, roomCapacityField: v }))}
                required
              />
            </div>
          </div>

          {solverError && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
              {solverError}
            </div>
          )}

          <button
            onClick={runSolver}
            disabled={isProcessing || !mappingComplete}
            style={{
              padding: '11px 20px',
              background: isProcessing || !mappingComplete ? '#93c5fd' : '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: isProcessing || !mappingComplete ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: 14,
              alignSelf: 'flex-start',
            }}
          >
            {isProcessing ? '⏳ Calculating optimal schedule…' : '▶ Generate Duty Assignments'}
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Step 3: Results + export                                            */}
      {/* ------------------------------------------------------------------ */}
      {step === 3 && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {[
              { label: 'Total Slots', value: result.summary.totalSlots, color: '#2563eb' },
              { label: 'Assigned', value: result.summary.assignedSlots, color: '#16a34a' },
              { label: 'Conflicts', value: result.summary.conflictSlots, color: result.summary.conflictSlots > 0 ? '#dc2626' : '#9ca3af' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ padding: 16, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {result.summary.conflictSlots > 0 && (
            <div style={{ padding: '10px 14px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
              ⚠️ {result.summary.conflictSlots} slot{result.summary.conflictSlots > 1 ? 's' : ''} could not be fully staffed.
              This usually means there aren't enough eligible faculty for those rooms.
              You can manually override assignments after downloading.
            </div>
          )}

          {/* Assignment preview table */}
          {assignments.length > 0 && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginBottom: 10 }}>
                Assignment Preview ({Math.min(assignments.length, 10)} of {assignments.length})
              </div>
              <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', background: '#f9fafb', padding: '8px 12px', fontSize: 12, fontWeight: 600, color: '#374151', borderBottom: '1px solid #e5e7eb' }}>
                  <div>Faculty ID</div>
                  <div>Room ID</div>
                  <div>Override</div>
                </div>
                {assignments.slice(0, 10).map(a => (
                  <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', padding: '7px 12px', fontSize: 13, borderBottom: '1px solid #f3f4f6', color: '#374151' }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.data.resource_id}</div>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.data.slot_id}</div>
                    <div>{a.data.is_override ? '✏️' : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={downloadCsv}
              style={{ padding: '9px 18px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
            >
              ⬇ Download CSV
            </button>
            <button
              onClick={() => { setStep(1); setColumns([]); setJobId(null); setResult(null); setAssignments([]); setMapping({ facultyNameField: '', experienceField: '', roomNameField: '', roomCapacityField: '' }); }}
              style={{ padding: '9px 18px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 14, color: '#374151' }}
            >
              Upload Another File
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
