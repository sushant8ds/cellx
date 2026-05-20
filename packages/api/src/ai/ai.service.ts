/**
 * AIService — LLM-powered orchestration agent
 * Supports: OpenAI (OPENAI_API_KEY) or Ollama (free, local)
 * Feature: universal-data-calibration-platform, Requirement 16
 */
import { addField, getSchema, deleteField } from '../schema/schema.service';
import { createFormula, getFormulas, deleteFormula } from '../formula/formula.service';
import { createAlertRule, getAlertRules, deleteAlertRule } from '../alerts/alert.service';
import { logger } from '../middleware/logging.middleware';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DataProfileColumn {
  name: string;
  inferredType: string;
  sampleValues: string[];
  missingCount: number;
  uniqueCount: number;
}

export interface DataProfile {
  filename: string;
  rowCount: number;
  columns: DataProfileColumn[];
}

export interface ChatChunk {
  type: 'text' | 'tool_call' | 'tool_result' | 'error';
  content: string;
  toolName?: string;
  toolArgs?: unknown;
  toolResult?: unknown;
}

// In-memory session store
const sessions = new Map<string, Array<{ role: string; content: string }>>();

// ---------------------------------------------------------------------------
// generateDataProfile
// ---------------------------------------------------------------------------

export function generateDataProfile(
  rows: Record<string, string>[],
  headers: string[],
  filename = 'upload',
): DataProfile {
  const sample = rows.slice(0, 50);
  const columns: DataProfileColumn[] = headers.map(col => {
    const values = sample.map(r => r[col] ?? '').filter(v => v.trim() !== '');
    const unique = new Set(values);
    const missing = sample.length - values.length;
    let inferredType = 'text';
    if (values.length > 0) {
      if (values.every(v => /^-?\d+$/.test(v.trim()))) inferredType = 'integer';
      else if (values.every(v => /^-?\d+(\.\d+)?$/.test(v.trim()))) inferredType = 'float';
      else if (values.every(v => !isNaN(Date.parse(v.trim())))) inferredType = 'date';
    }
    return { name: col, inferredType, sampleValues: [...unique].slice(0, 5), missingCount: missing, uniqueCount: unique.size };
  });
  return { filename, rowCount: rows.length, columns };
}

// ---------------------------------------------------------------------------
// Tool executor
// ---------------------------------------------------------------------------

async function executeTool(tenantId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  switch (toolName) {
    case 'list_fields': return getSchema(tenantId);
    case 'create_field': return addField(tenantId, { name: args.name as string, field_type: args.field_type as 'text' | 'integer' | 'float' | 'date' | 'status', dropdown_values: args.dropdown_values as string[] | undefined });
    case 'delete_field': return deleteField(tenantId, args.fieldId as string);
    case 'list_formulas': return getFormulas(tenantId);
    case 'create_formula': return createFormula(tenantId, { name: args.name as string, target_field_id: args.target_field_id as string, expression: args.expression as string });
    case 'delete_formula': return deleteFormula(tenantId, args.formulaId as string);
    case 'list_alert_rules': return getAlertRules(tenantId);
    case 'create_alert_rule': return createAlertRule(tenantId, { name: args.name as string, target_field_id: args.target_field_id as string, operator: args.operator as 'eq' | 'neq' | 'lt' | 'gt' | 'lte' | 'gte', threshold: args.threshold as string, recipients: args.recipients as string[] });
    case 'delete_alert_rule': return deleteAlertRule(tenantId, args.ruleId as string);
    default: throw new Error(`Unknown tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// Parse tool calls from LLM text response
// ---------------------------------------------------------------------------

function parseToolCall(text: string): { toolName: string; args: Record<string, unknown> } | null {
  // Look for JSON blocks that look like tool calls
  const match = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]) as Record<string, unknown>;
    if (parsed.tool && typeof parsed.tool === 'string') {
      return { toolName: parsed.tool as string, args: (parsed.args as Record<string, unknown>) ?? {} };
    }
  } catch { /* ignore */ }
  return null;
}

// ---------------------------------------------------------------------------
// LLM call — supports OpenAI and Ollama
// ---------------------------------------------------------------------------

async function callLLM(messages: Array<{ role: string; content: string }>): Promise<string> {
  const openaiKey = process.env.OPENAI_API_KEY;
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';

  if (openaiKey) {
    // Use OpenAI
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: openaiKey });
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: messages as Parameters<typeof client.chat.completions.create>[0]['messages'],
    });
    return response.choices[0].message.content ?? '';
  }

  // Use Ollama (free, local)
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      messages,
      stream: false,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Ollama error: ${err}. Make sure Ollama is running: https://ollama.com`);
  }

  const data = await response.json() as { message?: { content?: string } };
  return data.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(dataProfile?: DataProfile): string {
  return `You are an expert data system architect embedded in the UDCP platform.
${dataProfile ? `The user has uploaded a file. Data profile:\n${JSON.stringify(dataProfile, null, 2)}` : ''}

Help the user build their data management system. You can call tools by responding with JSON in this format:
\`\`\`json
{"tool": "tool_name", "args": {...}}
\`\`\`

Available tools:
- list_fields() — list existing schema fields
- create_field(name, field_type: text|integer|float|date|status, dropdown_values?: string[]) — create a field
- delete_field(fieldId) — delete a field
- list_formulas() — list formulas
- create_formula(name, target_field_id, expression) — create formula using [fieldId] syntax
- delete_formula(formulaId) — delete a formula
- list_alert_rules() — list alert rules
- create_alert_rule(name, target_field_id, operator: eq|neq|lt|gt|lte|gte, threshold, recipients: string[]) — create alert
- delete_alert_rule(ruleId) — delete an alert rule

Rules:
- Always call list_fields first before creating fields to avoid duplicates
- Use field IDs (UUIDs) when referencing fields in formulas and alerts
- Formula syntax: use [fieldId] to reference fields. Supports +, -, *, /, IF(), DATE_ADD()
- Be concise and explain what you're doing
- If unclear, ask one clarifying question`;
}

// ---------------------------------------------------------------------------
// chat — agentic loop
// ---------------------------------------------------------------------------

export async function* chat(
  tenantId: string,
  sessionId: string,
  userMessage: string,
  dataProfile?: DataProfile,
): AsyncGenerator<ChatChunk> {
  const sessionKey = `${tenantId}:${sessionId}`;
  if (!sessions.has(sessionKey)) sessions.set(sessionKey, []);
  const history = sessions.get(sessionKey)!;

  history.push({ role: 'user', content: userMessage });

  const messages = [
    { role: 'system', content: buildSystemPrompt(dataProfile) },
    ...history,
  ];

  let iterations = 0;
  const MAX_ITERATIONS = 8;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    let responseText: string;
    try {
      responseText = await callLLM(messages);
    } catch (err) {
      yield { type: 'error', content: `AI error: ${String(err)}` };
      break;
    }

    // Check for tool call in response
    const toolCall = parseToolCall(responseText);

    if (toolCall) {
      // Strip the JSON block from the text and yield the rest
      const textPart = responseText.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/, '').trim();
      if (textPart) yield { type: 'text', content: textPart };

      yield { type: 'tool_call', content: `Calling ${toolCall.toolName}`, toolName: toolCall.toolName, toolArgs: toolCall.args };

      let toolResult: unknown;
      try {
        toolResult = await executeTool(tenantId, toolCall.toolName, toolCall.args);
        yield { type: 'tool_result', content: `${toolCall.toolName} succeeded`, toolName: toolCall.toolName, toolResult };
      } catch (err) {
        toolResult = { error: String(err) };
        yield { type: 'tool_result', content: `${toolCall.toolName} failed: ${String(err)}`, toolName: toolCall.toolName, toolResult };
      }

      // Add to messages and continue loop
      messages.push({ role: 'assistant', content: responseText });
      messages.push({ role: 'user', content: `Tool result for ${toolCall.toolName}: ${JSON.stringify(toolResult)}` });
    } else {
      // No tool call — final response
      yield { type: 'text', content: responseText };
      history.push({ role: 'assistant', content: responseText });
      break;
    }
  }

  // Cap history at 20 messages
  sessions.set(sessionKey, messages.slice(1).slice(-20));
}

export function clearSession(tenantId: string, sessionId: string): void {
  sessions.delete(`${tenantId}:${sessionId}`);
}
