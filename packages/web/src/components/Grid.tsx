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

interface GridProps {
  tenantId: string;
  initialFilters?: Record<string, string>;
  archived?: boolean;
  onSelectionChange?: (ids: string[]) => void;
}

function rowBg(status: string | undefined): string {
  if (!status) return '';
  const s = status.toLowerCase();
  if (s === 'safe') return '#d1fae5';
  if (s === 'warning' || s === 'near limit') return '#fef9c3';
  if (s === 'danger' || s === 'overdue' || s === 'calibration required') return '#fee2e2';
  return '';
}

interface EditingCell { rowId: string; fieldId: string; value: string; version: number }

export default function Grid({ tenantId, initialFilters = {}, archived = false, onSelectionChange }: GridProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [filters, setFilters] = useState<Record<string, string>>(initialFilters);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [cellError, setCellError] = useState<{ rowId: string; fieldId: string; msg: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [allRecords, setAllRecords] = useState<DataRecord[]>([]);

  const sortBy = sorting.length ? sorting.map(s => `${s.id}:${s.desc ? 'desc' : 'asc'}`).join(',') : undefined;

  const { data: schemaData } = useSchema(tenantId);
  const { data: recordsData, isFetching } = useRecords(tenantId, { limit: 100, cursor, sort_by: sortBy, filters, archived });
  const updateRecord = useUpdateRecord(tenantId);

  useEffect(() => {
    if (!recordsData) return;
    if (!cursor) setAllRecords(recordsData.records);
    else setAllRecords(prev => [...prev, ...recordsData.records]);
  }, [recordsData]);

  const fields: DynamicField[] = schemaData ?? [];
  const columnHelper = createColumnHelper<DataRecord>();

  const columns = useMemo<ColumnDef<DataRecord, unknown>[]>(() => {
    const checkboxCol = columnHelper.display({
      id: '__select',
      header: () => (
        <input type="checkbox"
          checked={allRecords.length > 0 && selectedIds.size === allRecords.length}
          onChange={e => {
            const next = e.target.checked ? new Set(allRecords.map(r => r.id)) : new Set<string>();
            setSelectedIds(next); onSelectionChange?.([...next]);
          }} />
      ),
      cell: ({ row }) => (
        <input type="checkbox" checked={selectedIds.has(row.original.id)}
          onChange={e => {
            const id = row.original.id;
            const next = new Set(selectedIds);
            if (e.target.checked) next.add(id); else next.delete(id);
            setSelectedIds(next); onSelectionChange?.([...next]);
          }} />
      ),
      size: 40,
    });

    const fieldCols = fields.map(f =>
      columnHelper.accessor(row => row.data?.[f.id], {
        id: f.id,
        header: f.name,
        cell: ({ row, getValue }) => {
          const rec = row.original;
          const val = getValue();
          const isEditing = editingCell?.rowId === rec.id && editingCell?.fieldId === f.id;
          const err = cellError?.rowId === rec.id && cellError?.fieldId === f.id ? cellError.msg : null;

          if (isEditing) return (
            <div>
              <input autoFocus defaultValue={editingCell.value} style={{ width: '100%', boxSizing: 'border-box' }}
                onBlur={e => commitEdit(rec.id, f.id, e.target.value, rec.version, rec.data)}
                onKeyDown={e => {
                  if (e.key === 'Enter') commitEdit(rec.id, f.id, (e.target as HTMLInputElement).value, rec.version, rec.data);
                  if (e.key === 'Escape') setEditingCell(null);
                }} />
              {err && <div style={{ color: 'red', fontSize: 11 }}>{err}</div>}
            </div>
          );

          return (
            <div style={{ cursor: 'pointer', minHeight: 20 }}
              onClick={() => { setCellError(null); setEditingCell({ rowId: rec.id, fieldId: f.id, value: String(val ?? ''), version: rec.version }); }}>
              {String(val ?? '')}
            </div>
          );
        },
      })
    );
    return [checkboxCol, ...fieldCols];
  }, [fields, editingCell, cellError, selectedIds, allRecords]);

  const table = useReactTable({
    data: allRecords, columns,
    state: { sorting },
    onSortingChange: updater => { setSorting(updater); setCursor(undefined); setAllRecords([]); },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
  });

  const parentRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 36, overscan: 20 });
  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();

  const handleScroll = useCallback(() => {
    const el = parentRef.current;
    if (!el || isFetching || !recordsData?.nextCursor) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) setCursor(recordsData.nextCursor);
  }, [isFetching, recordsData]);

  async function commitEdit(rowId: string, fieldId: string, newValue: string, version: number, currentData: Record<string, unknown>) {
    setEditingCell(null);
    try {
      await updateRecord.mutateAsync({ recordId: rowId, data: { ...currentData, [fieldId]: newValue }, version });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 409) setCellError({ rowId, fieldId, msg: 'Record changed by another user. Refresh to retry.' });
    }
  }

  const statusField = fields.find(f => f.field_type === 'status');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, padding: '8px 0', flexWrap: 'wrap' }}>
        {fields.map(f => (
          <div key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <label style={{ fontSize: 11, color: '#555' }}>{f.name}</label>
            {f.field_type === 'status' && f.dropdown_values ? (
              <select value={filters[f.id] ?? ''} onChange={e => { const v = e.target.value; setFilters(p => { const n = { ...p }; if (v) n[f.id] = v; else delete n[f.id]; return n; }); setCursor(undefined); setAllRecords([]); }} style={{ padding: '2px 4px', fontSize: 12 }}>
                <option value="">All</option>
                {f.dropdown_values.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            ) : (
              <input type={f.field_type === 'integer' || f.field_type === 'float' ? 'number' : 'text'} placeholder={`Filter ${f.name}`} value={filters[f.id] ?? ''}
                onChange={e => { const v = e.target.value; setFilters(p => { const n = { ...p }; if (v) n[f.id] = v; else delete n[f.id]; return n; }); setCursor(undefined); setAllRecords([]); }}
                style={{ padding: '2px 4px', fontSize: 12, width: 120 }} />
            )}
          </div>
        ))}
      </div>

      {/* Table */}
      <div ref={parentRef} onScroll={handleScroll} style={{ flex: 1, overflow: 'auto', border: '1px solid #e5e7eb' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, background: '#f9fafb', zIndex: 1 }}>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map(header => (
                  <th key={header.id} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 12, fontWeight: 600, borderBottom: '1px solid #e5e7eb', cursor: header.column.getCanSort() ? 'pointer' : 'default', userSelect: 'none', width: header.column.id === '__select' ? 40 : undefined }}
                    onClick={header.column.getToggleSortingHandler()}>
                    {flexRender(header.column.columnDef.header, header.getContext())}
                    {header.column.getIsSorted() === 'asc' ? ' ↑' : header.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody style={{ position: 'relative', height: totalSize }}>
            {virtualItems.map(vi => {
              const row = rows[vi.index];
              const statusVal = statusField ? String(row.original.data?.[statusField.id] ?? '') : '';
              return (
                <tr key={row.id} style={{ position: 'absolute', top: vi.start, left: 0, width: '100%', height: vi.size, background: rowBg(statusVal) || undefined }}>
                  {row.getVisibleCells().map(cell => (
                    <td key={cell.id} style={{ padding: '4px 8px', fontSize: 13, borderBottom: '1px solid #f3f4f6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {isFetching && <div style={{ textAlign: 'center', padding: 8, fontSize: 12, color: '#888' }}>Loading…</div>}
      </div>
    </div>
  );
}
