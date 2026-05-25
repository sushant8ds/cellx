import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useSchema, useRecords, useUpdateRecord, type DynamicField, type DataRecord } from '../hooks/useRecords';
import api from '../lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GridProps {
  tenantId: string;
  initialFilters?: Record<string, string>;
  archived?: boolean;
  onSelectionChange?: (ids: string[]) => void;
  collectionId?: string | null;
}

interface EditingCell {
  rowId: string;
  fieldId: string;
  value: string;
  version: number;
}

interface ActiveCell {
  rowIndex: number;
  colIndex: number; // 1-based among data columns (0 = checkbox)
  rowId: string;
  fieldId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function rowBg(status: string): string {
  const s = status.toLowerCase();
  if (s === 'safe') return '#d1fae5';
  if (s === 'warning' || s === 'near limit') return '#fef9c3';
  if (s === 'danger' || s === 'overdue' || s === 'calibration required') return '#fee2e2';
  return '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Grid({
  tenantId,
  initialFilters = {},
  archived = false,
  onSelectionChange,
  collectionId,
}: GridProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [cellError, setCellError] = useState<{ rowId: string; fieldId: string; msg: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allRecords, setAllRecords] = useState<DataRecord[]>([]);
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');

  const sortBy = sorting.length
    ? sorting.map(s => `${s.id}:${s.desc ? 'desc' : 'asc'}`).join(',')
    : undefined;

  // Merge collectionId into filters so the API scopes records to the active dataset
  const combinedFilters = useMemo(() => {
    const f = { ...filters };
    if (collectionId) f['collection_id'] = collectionId;
    return f;
  }, [filters, collectionId]);

  const { data: schemaData, refetch: refetchSchema } = useSchema(tenantId);
  const { data: recordsData, isFetching } = useRecords(tenantId, {
    limit: 100,
    cursor,
    sort_by: sortBy,
    filters: combinedFilters,
    archived,
  });
  const updateRecord = useUpdateRecord(tenantId);

  useEffect(() => {
    if (!recordsData) return;
    if (!cursor) setAllRecords(recordsData.records);
    else setAllRecords(prev => [...prev, ...recordsData.records]);
  }, [recordsData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset when switching collections
  useEffect(() => {
    setCursor(undefined);
    setAllRecords([]);
    setActiveCell(null);
    setEditingCell(null);
  }, [collectionId]);

  const fields: DynamicField[] = schemaData ?? [];
  const columnHelper = createColumnHelper<DataRecord>();

  const columns = useMemo<ColumnDef<DataRecord, unknown>[]>(() => {
    const checkboxCol = columnHelper.display({
      id: '__select',
      header: () => (
        <input
          type="checkbox"
          checked={allRecords.length > 0 && selectedIds.size === allRecords.length}
          onChange={e => {
            const next = e.target.checked
              ? new Set(allRecords.map(r => r.id))
              : new Set<string>();
            setSelectedIds(next);
            onSelectionChange?.([...next]);
          }}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.original.id)}
          onChange={e => {
            const id = row.original.id;
            const next = new Set(selectedIds);
            if (e.target.checked) next.add(id); else next.delete(id);
            setSelectedIds(next);
            onSelectionChange?.([...next]);
          }}
        />
      ),
      size: 40,
    });

    const fieldCols = fields.map((f, fIdx) =>
      columnHelper.accessor(row => row.data?.[f.id], {
        id: f.id,
        header: f.name,
        cell: ({ row, getValue }) => {
          const rec = row.original;
          const rowIndex = row.index;
          const val = getValue();
          const isEditing = editingCell?.rowId === rec.id && editingCell?.fieldId === f.id;
          const isActive = activeCell?.rowId === rec.id && activeCell?.fieldId === f.id;
          const err = cellError?.rowId === rec.id && cellError?.fieldId === f.id
            ? cellError.msg
            : null;

          if (isEditing) {
            return (
              <div style={{ width: '100%', position: 'relative' }}>
                <input
                  autoFocus
                  defaultValue={editingCell.value}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '2px 6px', border: '2px solid #2563eb',
                    borderRadius: 3, fontSize: 13, outline: 'none',
                  }}
                  onBlur={e => commitEdit(rec.id, f.id, e.target.value, rec.version, rec.data)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      commitEdit(rec.id, f.id, (e.target as HTMLInputElement).value, rec.version, rec.data);
                    }
                    if (e.key === 'Escape') setEditingCell(null);
                  }}
                />
                {err && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, zIndex: 20,
                    background: '#fff', border: '1px solid #fca5a5',
                    borderRadius: 4, padding: '3px 6px', fontSize: 11, color: '#dc2626',
                    whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.1)',
                  }}>
                    {err}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div
              style={{
                cursor: 'cell',
                minHeight: 22,
                width: '100%',
                padding: '2px 6px',
                outline: isActive ? '2px solid #2563eb' : 'none',
                outlineOffset: '-2px',
                background: isActive ? '#eff6ff' : 'transparent',
                userSelect: 'none',
                fontSize: 13,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              onClick={() => {
                setCellError(null);
                setActiveCell({ rowIndex, colIndex: fIdx + 1, rowId: rec.id, fieldId: f.id });
              }}
              onDoubleClick={() => {
                setEditingCell({ rowId: rec.id, fieldId: f.id, value: String(val ?? ''), version: rec.version });
              }}
            >
              {String(val ?? '')}
            </div>
          );
        },
      })
    );

    return [checkboxCol, ...fieldCols];
  }, [fields, editingCell, cellError, selectedIds, allRecords, activeCell]); // eslint-disable-line react-hooks/exhaustive-deps

  const table = useReactTable({
    data: allRecords,
    columns,
    state: { sorting },
    onSortingChange: updater => { setSorting(updater); setCursor(undefined); setAllRecords([]); },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 36,
    overscan: 15,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  // ---------------------------------------------------------------------------
  // Keyboard navigation (Excel-style)
  // ---------------------------------------------------------------------------
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!activeCell || editingCell) return;

    const maxRows = rows.length - 1;
    const maxCols = fields.length; // 1-based max col index
    let { rowIndex, colIndex } = activeCell;
    let moved = false;

    if (e.key === 'ArrowUp' && rowIndex > 0) { rowIndex--; moved = true; }
    else if (e.key === 'ArrowDown' && rowIndex < maxRows) { rowIndex++; moved = true; }
    else if (e.key === 'ArrowLeft' && colIndex > 1) { colIndex--; moved = true; }
    else if (e.key === 'ArrowRight' && colIndex < maxCols) { colIndex++; moved = true; }
    else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        if (colIndex > 1) { colIndex--; moved = true; }
      } else {
        if (colIndex < maxCols) { colIndex++; moved = true; }
        else if (rowIndex < maxRows) { rowIndex++; colIndex = 1; moved = true; }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[rowIndex];
      const field = fields[colIndex - 1];
      if (row && field) {
        const currentVal = row.original.data?.[field.id];
        setEditingCell({
          rowId: row.original.id,
          fieldId: field.id,
          value: String(currentVal ?? ''),
          version: row.original.version,
        });
      }
      return;
    }

    if (moved) {
      e.preventDefault();
      const targetRow = rows[rowIndex];
      const targetField = fields[colIndex - 1];
      if (targetRow && targetField) {
        setActiveCell({ rowIndex, colIndex, rowId: targetRow.original.id, fieldId: targetField.id });
        virtualizer.scrollToIndex(rowIndex, { align: 'auto' });
      }
    }
  }, [activeCell, editingCell, rows, fields, virtualizer]);

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || isFetching || !recordsData?.nextCursor) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      setCursor(recordsData.nextCursor);
    }
  }, [isFetching, recordsData]);

  // ---------------------------------------------------------------------------
  // Cell commit
  // ---------------------------------------------------------------------------
  async function commitEdit(
    rowId: string,
    fieldId: string,
    newValue: string,
    version: number,
    currentData: Record<string, unknown>,
  ) {
    setEditingCell(null);
    try {
      await updateRecord.mutateAsync({ recordId: rowId, data: { ...currentData, [fieldId]: newValue }, version });
      // Optimistic local update so the cell reflects the change immediately
      setAllRecords(prev =>
        prev.map(r =>
          r.id === rowId
            ? { ...r, version: version + 1, data: { ...r.data, [fieldId]: newValue } }
            : r,
        ),
      );
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) {
        setCellError({ rowId, fieldId, msg: 'Conflict: row was modified elsewhere. Double-click to retry.' });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Add column
  // ---------------------------------------------------------------------------
  async function handleAddColumn() {
    const name = newColumnName.trim();
    if (!name) return;
    try {
      await api.post(`/tenants/${tenantId}/schema/fields`, { name, field_type: 'text' });
      setNewColumnName('');
      setIsAddingColumn(false);
      refetchSchema();
    } catch {
      alert('Failed to add column. Check that the name is unique.');
    }
  }

  const statusField = fields.find(f => f.field_type === 'status');

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', outline: 'none' }}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    >
      {/* Filter bar */}
      {fields.length > 0 && (
        <div style={{ display: 'flex', gap: 8, padding: '6px 0', flexWrap: 'wrap', alignItems: 'flex-end', flexShrink: 0 }}>
          {fields.map(f => (
            <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 11, color: '#6b7280', fontWeight: 500 }}>{f.name}</label>
              {f.field_type === 'status' && f.dropdown_values ? (
                <select
                  value={filters[f.id] ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    setFilters(p => { const n = { ...p }; if (v) n[f.id] = v; else delete n[f.id]; return n; });
                    setCursor(undefined); setAllRecords([]);
                  }}
                  style={{ padding: '3px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db' }}
                >
                  <option value="">All</option>
                  {f.dropdown_values.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              ) : (
                <input
                  type={f.field_type === 'integer' || f.field_type === 'float' ? 'number' : 'text'}
                  placeholder={`Filter ${f.name}`}
                  value={filters[f.id] ?? ''}
                  onChange={e => {
                    const v = e.target.value;
                    setFilters(p => { const n = { ...p }; if (v) n[f.id] = v; else delete n[f.id]; return n; });
                    setCursor(undefined); setAllRecords([]);
                  }}
                  style={{ padding: '3px 6px', fontSize: 12, width: 110, borderRadius: 4, border: '1px solid #d1d5db' }}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Grid */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        style={{
          flex: 1, overflow: 'auto', border: '1px solid #e5e7eb',
          position: 'relative', borderRadius: 6, background: '#fff',
        }}
      >
        <div style={{ width: '100%', minWidth: 'max-content' }}>

          {/* Header row */}
          <div style={{
            position: 'sticky', top: 0, background: '#f9fafb', zIndex: 2,
            borderBottom: '2px solid #e5e7eb', display: 'flex', alignItems: 'center',
          }}>
            {table.getHeaderGroups().map(hg => (
              <div key={hg.id} style={{ display: 'flex', width: '100%' }}>
                {hg.headers.map(header => (
                  <div
                    key={header.id}
                    style={{
                      padding: '9px 12px',
                      textAlign: 'left',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#374151',
                      borderRight: '1px solid #e5e7eb',
                      cursor: header.column.getCanSort() ? 'pointer' : 'default',
                      userSelect: 'none',
                      width: header.column.id === '__select' ? 40 : header.getSize(),
                      flexGrow: header.column.id === '__select' ? 0 : 1,
                      boxSizing: 'border-box',
                    }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' ? ' ↑'
                      : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                  </div>
                ))}
              </div>
            ))}

            {/* + Add Column button */}
            <div style={{ padding: '4px 10px', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {isAddingColumn ? (
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input
                    autoFocus
                    placeholder="Column name"
                    value={newColumnName}
                    onChange={e => setNewColumnName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleAddColumn();
                      if (e.key === 'Escape') { setIsAddingColumn(false); setNewColumnName(''); }
                    }}
                    style={{
                      fontSize: 12, padding: '3px 6px',
                      border: '1px solid #2563eb', borderRadius: 4, outline: 'none', width: 120,
                    }}
                  />
                  <button
                    onClick={handleAddColumn}
                    style={{ background: '#10b981', color: '#fff', border: 'none', borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}
                  >✓</button>
                  <button
                    onClick={() => { setIsAddingColumn(false); setNewColumnName(''); }}
                    style={{ background: '#f3f4f6', color: '#6b7280', border: '1px solid #d1d5db', borderRadius: 4, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }}
                  >×</button>
                </div>
              ) : (
                <button
                  onClick={() => setIsAddingColumn(true)}
                  style={{
                    background: 'transparent', color: '#6b7280',
                    border: '1px dashed #d1d5db', borderRadius: 4,
                    padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  + Add Column
                </button>
              )}
            </div>
          </div>

          {/* Empty state */}
          {rows.length === 0 && !isFetching && (
            <div style={{ padding: '48px 24px', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
              {fields.length === 0
                ? 'Add a column to get started, or upload a file from Data Sources.'
                : 'No records yet. Data will appear here after import.'}
            </div>
          )}

          {/* Virtual rows */}
          <div style={{ position: 'relative', height: totalSize, width: '100%' }}>
            {virtualItems.map(vi => {
              const row = rows[vi.index];
              const statusVal = statusField ? String(row.original.data?.[statusField.id] ?? '') : '';
              return (
                <div
                  key={row.id}
                  style={{
                    position: 'absolute',
                    top: vi.start,
                    left: 0,
                    width: '100%',
                    height: vi.size,
                    background: rowBg(statusVal) || undefined,
                    display: 'flex',
                    alignItems: 'stretch',
                    borderBottom: '1px solid #f3f4f6',
                    boxSizing: 'border-box',
                  }}
                >
                  {row.getVisibleCells().map(cell => (
                    <div
                      key={cell.id}
                      style={{
                        overflow: 'hidden',
                        width: cell.column.id === '__select' ? 40 : cell.column.getSize(),
                        flexGrow: cell.column.id === '__select' ? 0 : 1,
                        boxSizing: 'border-box',
                        borderRight: '1px solid #f3f4f6',
                        display: 'flex',
                        alignItems: 'center',
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {isFetching && (
          <div style={{
            textAlign: 'center', padding: 8, fontSize: 12, color: '#9ca3af',
            position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid #e5e7eb',
          }}>
            Loading…
          </div>
        )}
      </div>
    </div>
  );
}
