import React, { useState, useRef, useEffect } from 'react';
import api from '../lib/api';

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

export default function AiChat({ tenantId, dataProfile }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: dataProfile
        ? `I've analyzed your file **${dataProfile.filename}** (${dataProfile.rowCount} rows, ${dataProfile.columns.length} columns). What would you like to build? For example:\n\n• "Track overdue machine calibrations and alert the floor manager when capacity drops below 10%"\n• "Build a gauge inspection tracker with Safe/Warning/Danger status"\n• "Create a formula that calculates next calibration date as last calibration + 365 days"`
        : `Hi! I'm your AI assistant. Upload a file first, then describe what system you'd like to build and I'll configure it for you automatically.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || streaming) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setStreaming(true);

    // Add placeholder assistant message
    const assistantIdx = messages.length + 1;
    setMessages(prev => [...prev, { role: 'assistant', content: '', actions: [] }]);

    try {
      const response = await fetch(
        `/tenants/${tenantId}/ai/chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('udcp_token') ?? ''}`,
          },
          body: JSON.stringify({ message: text, sessionId, dataProfile }),
        },
      );

      // Read session ID from header
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
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, content: m.content + chunk.content } : m,
                ));
              } else if (chunk.type === 'tool_call' || chunk.type === 'tool_result') {
                setMessages(prev => prev.map((m, i) =>
                  i === assistantIdx ? { ...m, actions: [...(m.actions ?? []), chunk] } : m,
                ));
              }
            } catch { /* ignore parse errors */ }
          }
        }
      }
    } catch (err) {
      setMessages(prev => prev.map((m, i) =>
        i === assistantIdx ? { ...m, content: `Error: ${String(err)}` } : m,
      ));
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 500 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 20 }}>🤖</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>AI Assistant</div>
            <div style={{ fontSize: 11, color: '#6b7280' }}>Describe what you want to build</div>
          </div>
        </div>
        <button onClick={clearSession} style={{ fontSize: 12, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer' }}>
          Clear session
        </button>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((msg, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{
              maxWidth: '80%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              background: msg.role === 'user' ? '#2563eb' : '#f3f4f6',
              color: msg.role === 'user' ? '#fff' : '#111827',
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}>
              {msg.content || (streaming && i === messages.length - 1 ? '…' : '')}
            </div>

            {/* Activity log for tool calls */}
            {msg.actions && msg.actions.length > 0 && (
              <div style={{ maxWidth: '80%', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {msg.actions
                  .filter(a => a.type === 'tool_call')
                  .map((action, j) => (
                    <div key={j} style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{TOOL_ICONS[action.toolName ?? ''] ?? '⚙️'}</span>
                      <span><strong>{action.toolName}</strong></span>
                      {action.toolArgs && (
                        <span style={{ color: '#6b7280', fontFamily: 'monospace', fontSize: 11 }}>
                          {JSON.stringify(action.toolArgs).slice(0, 80)}
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder="Describe what you want to build… (Enter to send, Shift+Enter for new line)"
          disabled={streaming}
          rows={2}
          style={{
            flex: 1,
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: 8,
            fontSize: 14,
            resize: 'none',
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />
        <button
          onClick={sendMessage}
          disabled={streaming || !input.trim()}
          style={{
            padding: '8px 16px',
            background: streaming || !input.trim() ? '#93c5fd' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: streaming || !input.trim() ? 'not-allowed' : 'pointer',
            fontSize: 14,
            alignSelf: 'flex-end',
          }}
        >
          {streaming ? '…' : '→'}
        </button>
      </div>
    </div>
  );
}
