import React, { useState, useEffect } from 'react';
import { useAuth } from '../lib/auth';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssignmentRecord {
  id: string;
  data: {
    _type: string;
    resource_id: string;
    slot_id: string;
    item_ids: string[];
    is_override: boolean;
  };
}

interface SlotRecord {
  id: string;
  data: {
    _type: string;
    day: string;
    time_slot: string;
    room: string;
    room_label: string;
    time_key: string;
  };
}

interface FacultyRecord {
  id: string;
  data: Record<string, unknown>;
}

interface MatrixCell {
  slotId: string;
  resourceId: string | null;
  resourceName: string;
  isOverride: boolean;
  day: string;
  timeSlot: string;
  room: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  nameField?: string;
}

export default function AssignmentMatrix({ nameField }: Props) {
  const { user } = useAuth();
  const tenantId = user?.tenantId ?? '';

  const [assignments, setAssignments] = useState<AssignmentRecord[]>([]);
  const [slots, setSlots] = useState<SlotRecord[]>([]);
  const [faculty, setFaculty] = useState<FacultyRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overrideCell, setOverrideCell] = useState<{ slotId: string; currentResourceId: string | null } | null>(null);
  const [overrideResourceId, setOverrideResourceId] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadData();
  }, [tenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      const [assignRes, recordsRes] = await Promise.all([
        api.get<AssignmentRecord[]>(`/tenants/${tenantId}/solver/assignments`),
        api.get<{ records: FacultyRecord[] }>(`/tenants/${tenantId}/records`, {
          params: { limit: 500 },
        }),
      ]);

      setAssignments(assignRes.data);

      const allRecords = recordsRes.data.records;
      setSlots(allRecords.filter(r => (r.data as Record<string, unknown>)['_type'] === 'exam_slot') as unknown as SlotRecord[]);
      setFaculty(allRecords.filter(r => (r.data as Record<string, unknown>)['_type'] !== 'exam_slot' && (r.data as Record<string, unknown>)['_type'] !== 'assignment'));
    } catch (err: unknown) {
      setError('Failed to load assignment data.');
    } finally {
      setIsLoading(false);
    }
  }

  // Build a lookup: slotId → assignment
  const assignmentBySlot = new Map<string, AssignmentRecord>();
  for (const a of assignments) {
    assignmentBySlot.set(a.data.slot_id, a);
  }

  // Build faculty name lookup
  const facultyById = new Map<string, FacultyRecord>();
  for (const f of faculty) facultyById.set(f.id, f);

  function getFacultyName(id: string): string {
    const f = facultyById.get(id);
    if (!f) return id.slice(0, 8) + '…';
    if (nameField && f.data[nameField]) return String(f.data[nameField]);
    // Try common name fields
    for (const key of ['name', 'Name', 'faculty_name', 'Faculty Name', 'full_name']) {
      if (f.data[key]) return String(f.data[key]);
    }
    return id.slice(0, 8) + '…';
  }

  // Group slots by day
  const slotsByDay = new Map<string, SlotRecord[]>();
  for (const slot of slots) {
    const day = slot.data.day ?? 'Day 1';
    if (!slotsByDay.has(day)) slotsByDay.set(day, []);
    slotsByDay.get(day)!.push(slot);
  }

  const days = [...slotsByDay.keys()].sort();

  // Get unique time slots
  const timeSlots = [...new Set(slots.map(s => s.data.time_slot))].sort();

  // Get unique rooms
  const rooms = [...new Set(slots.map(s => s.data.room))].sort((a, b) => {
    const na = parseInt(a.replace(/\D/g, ''));
    const nb = parseInt(b.replace(/\D/g, ''));
    return na - nb;
  });

  // ---------------------------------------------------------------------------
  // Override
  // ---------------------------------------------------------------------------

  async function saveOverride() {
    if (!overrideCell || !overrideResourceId) return;
    setIsSaving(true);
    try {
      const assignment = assignmentBySlot.get(overrideCell.slotId);
      if (assignment) {
        await api.post(`/tenants/${tenantId}/solver/assignments/${assignment.id}/override`, {
          resourceId: overrideResourceId,
          slotId: overrideCell.slotId,
        });
      }
      setOverrideCell(null);
      setOverrideResourceId('');
      await loadData();
    } catch {
      setError('Failed to save override.');
    } finally {
      setIsSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Export CSV
  // ---------------------------------------------------------------------------

  function exportCsv() {
    const rows = [['Day', 'Time Slot', 'Room', 'Assigned Faculty', 'Override']];
    for (const slot of slots) {
      const assignment = assignmentBySlot.get(slot.id);
      const name = assignment ? getFacultyName(assignment.data.resource_id) : '—';
      const isOverride = assignment?.data.is_override ? 'Yes' : 'No';
      rows.push([slot.data.day, slot.data.time_slot, slot.data.room, name, isOverride]);
    }
    const csv = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'exam-duty-assignments.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
        Loading assignments…
      </div>
    );
  }

  if (assignments.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#374151', marginBottom: 6 }}>No assignments yet</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>Run the Solver Wizard to generate duty assignments</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'inherit' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: 0 }}>Assignment Matrix</h3>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>
            {assignments.length} assignments · {slots.length} slots · Click a cell to override
          </p>
        </div>
        <button
          onClick={exportCsv}
          style={{ padding: '7px 16px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}
        >
          ⬇ Export CSV
        </button>
      </div>

      {error && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, fontSize: 13, color: '#dc2626' }}>
          {error}
        </div>
      )}

      {/* Matrix — one table per day */}
      {days.map(day => (
        <div key={day} style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8, padding: '4px 0', borderBottom: '2px solid #e5e7eb' }}>
            {day}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 400 }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>
                    Room
                  </th>
                  {timeSlots.map(ts => (
                    <th key={ts} style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#6b7280', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>
                      {ts}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rooms.map((room, ri) => (
                  <tr key={room} style={{ background: ri % 2 === 0 ? '#fff' : '#fafafa' }}>
                    <td style={{ padding: '7px 12px', fontSize: 12, fontWeight: 600, color: '#374151', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' }}>
                      {room}
                    </td>
                    {timeSlots.map(ts => {
                      const slot = slotsByDay.get(day)?.find(s => s.data.time_slot === ts && s.data.room === room);
                      if (!slot) return <td key={ts} style={{ padding: '7px 12px', borderBottom: '1px solid #f3f4f6' }} />;

                      const assignment = assignmentBySlot.get(slot.id);
                      const name = assignment ? getFacultyName(assignment.data.resource_id) : null;
                      const isOverride = assignment?.data.is_override ?? false;

                      return (
                        <td
                          key={ts}
                          onClick={() => {
                            setOverrideCell({ slotId: slot.id, currentResourceId: assignment?.data.resource_id ?? null });
                            setOverrideResourceId(assignment?.data.resource_id ?? '');
                          }}
                          style={{
                            padding: '7px 12px',
                            fontSize: 12,
                            borderBottom: '1px solid #f3f4f6',
                            textAlign: 'center',
                            cursor: 'pointer',
                            background: name ? (isOverride ? '#fef3c7' : '#f0fdf4') : '#fef2f2',
                            color: name ? (isOverride ? '#92400e' : '#166534') : '#dc2626',
                            whiteSpace: 'nowrap',
                            transition: 'background 0.1s',
                          }}
                          title={isOverride ? 'Manually overridden — click to change' : 'Click to override'}
                        >
                          {name ?? '—'}
                          {isOverride && <span style={{ marginLeft: 4, fontSize: 10 }}>✏️</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {/* Override modal */}
      {overrideCell && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 16 }}>Override Assignment</h3>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 6 }}>
                Assign to:
              </label>
              <select
                value={overrideResourceId}
                onChange={e => setOverrideResourceId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }}
              >
                <option value="">— Unassign —</option>
                {faculty.map(f => (
                  <option key={f.id} value={f.id}>{getFacultyName(f.id)}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setOverrideCell(null); setOverrideResourceId(''); }}
                style={{ flex: 1, padding: '9px 0', background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                onClick={saveOverride}
                disabled={isSaving}
                style={{ flex: 1, padding: '9px 0', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
              >
                {isSaving ? 'Saving…' : 'Save Override'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
