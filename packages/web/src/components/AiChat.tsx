import React, { useState, useRef, useEffect, useMemo } from 'react';
import api from '../lib/api';
import { useSchema } from '../hooks/useRecords';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DataProfile {
  filename: string;
  rowCount: number;
  columns: Array<{ name: string; inferredType: string; sampleValues: string[] }>;
}

interface ChatChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  actions?: ChatChunk[];
}

interface Props {
  tenantId: string;
  dataProfile?: DataProfile;
}

const TOOL_ICONS: Record<string, string> = {
  create_field: '🏗️',
  delete_field: '🗑️',
  create_formula: '🧮',
  delete_formula: '🗑️',
  create_alert_rule: '🔔',
  delete_alert_rule: '🗑️',
  list_fields: '📋',
  list_formulas: '📋',
  list_alert_rules: '📋',
};

// ---------------------------------------------------------------------------
// Schema-aware suggestion engine
// ---------------------------------------------------------------------------

function buildSuggestions(
  schemaFields: { name: string; field_type: string }[] | undefined,
  dataProfile: DataProfile | undefined,
): string[] {
  if (!schemaFields || schemaFields.length === 0) {
    return [
      'Create an exam seating inventory layout',
      'Build a multi-column employee attendance tracker',
      'Generate a formula column that calculates running totals',
    ];
  }

  const names = schemaFields.map(f => f.name.toLowerCase());

  if (names.some(n => n.includes('teacher') || n.includes('faculty') || n.includes('room') || n.includes('invigilat'))) {
    return [
      'Allocate faculty to classrooms matching experience tiers',
      'Flag slots where room capacity falls below the required minimum',
      'Send an email alert when a duty slot has no assigned invigilator',
    ];
  }

  if (names.some(n => n.includes('calib') || n.includes('machin') || n.includes('devic') || n.includes('gauge'))) {
    return [
      'Calculate next calibration date as last inspection date + 365 days',
      'Set a Danger alert when any status field reads "Overdue"',
      'Aggregate equipment status counts by category',
    ];
  }

  if (names.some(n => n.includes('stock') || n.includes('inventory') || n.includes('qty') || n.includes('quantity'))) {
    return [
      'Alert me when stock quantity drops below the reorder threshold',
      'Calculate total inventory value as quantity × unit price',
      'Flag items where last restock date is older than 90 days',
    ];
  }

  // Generic fallback using actual field names
  const first = schemaFields[0].name;
  const second = schemaFields[1]?.name;
  return [
    `Calculate a formula using the [${first}] column`,
    second
      ? `Create an alert when [${first}] and [${second}] values conflict`
      : `Set an alert threshold on the [${first}] column`,
    dataProfile
      ? `Analyze the ${dataProfile.rowCount} rows in ${dataProfile.filename} for anomalies`
      : 'Ask AI to inspect this worksheet for structural issues',
  ];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AiChat({ tenantId, dataProfile }: Props) {
  const { data: schemaFields } = useSchema(tenantId);

  const intelligentSuggestions = useMemo(
    () => buildSuggestions(schemaFields, dataProfile),
    [schemaFields, dataProfile],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Re-initialize greeting when schema or dataProfile changes
  useEffect(() => {
    setMessages([{
      role: 'assistant',
      content: dataProfile
        ? `I've analyzed **${dataProfile.filename}** (${dataProfile.rowCount} rows, ${dataProfile.columns.length} columns). What system rules should we deploy? Click a suggestion below or describe your goal:`
        : `Hi! I'm your AI Co-Pilot. I can read your columns or connected files to build formula chains, alert thresholds, and solver constraints automatically. What are we building today?`,
    }]);
  }, [dataProfile, schemaFields]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ---------------------------------------------------------------------------
  // Streaming send
  // ---------------------------------------------------------------------------
  async function sendMessage(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || streaming) return;

    setInput('');
    setStreaming(true);

    setMessages(prev => [
      ...prev,
      { role: 'user', content: msg },
      { role: 'assistant', content: '', actions: [] },
    ]);

    try {
      const response = await fetch(`/tenants/${tenantId}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('udcp_token') ?? ''}`,
        },
        body: JSON.stringify({ message: msg, sessionId, dataProfile }),
      });

      const newSessionId = response.headers.get('X-Session-Id');
      if (newSessionId) setSessionId(newSessionId);

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
              const chunk = JSON.parse(line.slice(6)) as ChatChunk & { sessionId?: string };

              if (chunk.type === 'text') {
                setMessages(prev => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      content: updated[lastIdx].content + chunk.content,
                    };
                  }
                  return updated;
                });
              } else if (chunk.type === 'tool_call' || chunk.type === 'tool_result') {
                setMessages(prev => {
                  const updated = [...prev];
                  const lastIdx = updated.length - 1;
                  if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                    updated[lastIdx] = {
                      ...updated[lastIdx],
                      actions: [...(updated[lastIdx].actions ?? []), chunk],
                    };
                  }
                  return updated;
                });
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = { ...updated[lastIdx], content: `Error: ${String(err)}` };
        }
        return updated;
      });
    } finally {
      setStreaming(false);
    }
  }

  async function clearSession() {
    if (sessionId) {
      await api.delete(`/tenants/${tenantId}/ai/sessions/${sessionId}`).catch(() => {});
      setSessionId(undefined);
    }
    setMessages([{
      role: 'assistant',
      content: 'Session cleared. How can I help you build your system?',
    }]);
  }

  const showSuggestions = !streaming && messages.length <= 2;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 14px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}>AI Co-Pilot</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>
              {schemaFields && schemaFields.length > 0
                ? `${schemaFields.length} columns detected`
                : 'Describe what you want to build'}
            </div>
          </div>
        </div>
        <button
          onClick={clearSession}
          style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.map((msg, i) => (
          <div
            key={i}
            style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
          >
            <div style={{
              maxWidth: '88%',
              padding: '9px 13px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
              color: msg.role === 'user' ? '#fff' : '#111827',
              fontSize: 13,
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content || (streaming && i === messages.length - 1 ? '…' : '')}
            </div>

            {/* Tool call activity log */}
            {msg.actions && msg.actions.length > 0 && (
              <div style={{ maxWidth: '88%', marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {msg.actions
                  .filter(a => a.type === 'tool_call')
                  .map((action, j) => (
                    <div key={j} style={{
                      background: '#eff6ff', border: '1px solid #bfdbfe',
                      borderRadius: 6, padding: '5px 9px', fontSize: 11,
                      color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                      <span>{TOOL_ICONS[action.toolName ?? ''] ?? '⚙️'}</span>
                      <strong>{action.toolName}</strong>
                      {action.toolArgs && (
                        <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 10 }}>
                          {JSON.stringify(action.toolArgs).slice(0, 60)}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}

        {/* Schema-aware suggestion pills */}
        {showSuggestions && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginTop: 4 }}>
            <span style={{ fontSize: 11, color: '#9ca3af', fontWeight: 500 }}>Suggested actions:</span>
            {intelligentSuggestions.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(prompt)}
                style={{
                  textAlign: 'left',
                  padding: '8px 11px',
                  background: '#f0f4ff',
                  border: '1px solid #dbeafe',
                  borderRadius: 8,
                  color: '#1e40af',
                  fontSize: 12,
                  cursor: 'pointer',
                  lineHeight: 1.4,
                }}
                onMouseOver={e => { (e.currentTarget as HTMLButtonElement).style.background = '#e0eafd'; }}
                onMouseOut={e => { (e.currentTarget as HTMLButtonElement).style.background = '#f0f4ff'; }}
              >
                ⚡ {prompt}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8, flexShrink: 0 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
          }}
          placeholder="Describe what you want to build… (Enter to send)"
          disabled={streaming}
          rows={2}
          style={{
            flex: 1, padding: '7px 10px',
            border: '1px solid #d1d5db', borderRadius: 8,
            fontSize: 13, resize: 'none', fontFamily: 'inherit', outline: 'none',
          }}
        />
        <button
          onClick={() => sendMessage()}
          disabled={streaming || !input.trim()}
          style={{
            padding: '7px 14px',
            background: streaming || !input.trim() ? '#93c5fd' : '#2563eb',
            color: '#fff', border: 'none', borderRadius: 8,
            cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize: 14, alignSelf: 'flex-end',
          }}
        >
          {streaming ? '…' : '→'}
        </button>
      </div>
    </div>
  );
}
