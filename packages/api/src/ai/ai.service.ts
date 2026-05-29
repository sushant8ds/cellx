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

    case 'setup_solver_problem': {
      // Creates constraint rules for the solver based on wizard answers
      const { pool } = await import('../db/pool');
      const { createConstraintRule } = await import('../solver/solver.service');
      const answers = args as {
        resourceFieldId: string;
        experienceFieldId?: string;
        classrooms: number;
        slotsPerDay: number;
        examDays: number;
        juniorMax: number;
        midMax: number;
        seniorMax: number;
        noSimultaneous: boolean;
      };

      const rules = [];

      // Min/max assignment rules per experience tier
      if (answers.experienceFieldId) {
        rules.push(await createConstraintRule(tenantId, {
          name: 'Junior faculty max duties',
          type: 'max_assignments',
          config: { resourceField: answers.experienceFieldId, value: answers.juniorMax, fieldValue: 'Junior' },
        }));
        rules.push(await createConstraintRule(tenantId, {
          name: 'Mid-level faculty max duties',
          type: 'max_assignments',
          config: { resourceField: answers.experienceFieldId, value: answers.midMax, fieldValue: 'Mid' },
        }));
        rules.push(await createConstraintRule(tenantId, {
          name: 'Senior faculty max duties',
          type: 'max_assignments',
          config: { resourceField: answers.experienceFieldId, value: answers.seniorMax, fieldValue: 'Senior' },
        }));
      }

      if (answers.noSimultaneous) {
        rules.push(await createConstraintRule(tenantId, {
          name: 'No simultaneous assignments',
          type: 'no_simultaneous',
          config: {},
        }));
      }

      // Generate exam slot records
      const totalSlots = answers.classrooms * answers.slotsPerDay * answers.examDays;
      const slotNames = ['Morning', 'Afternoon', 'Evening', 'Night'];
      const slotRecords = [];
      for (let day = 1; day <= answers.examDays; day++) {
        for (let slot = 0; slot < answers.slotsPerDay; slot++) {
          for (let room = 1; room <= answers.classrooms; room++) {
            const slotData = {
              _type: 'exam_slot',
              day: `Day ${day}`,
              time_slot: slotNames[slot] ?? `Slot ${slot + 1}`,
              room: `Room ${room}`,
              time_key: `day${day}_slot${slot}`,
              capacity: 1,
              priority: answers.examDays - day,
            };
            const r = await pool.query(
              `INSERT INTO records (tenant_id, data) VALUES ($1, $2) RETURNING id`,
              [tenantId, JSON.stringify(slotData)],
            );
            slotRecords.push(r.rows[0].id as string);
          }
        }
      }

      return {
        constraintRules: rules,
        slotsCreated: slotRecords.length,
        totalSlots,
        message: `Created ${rules.length} constraint rules and ${slotRecords.length} exam slots. Ready to run the solver.`,
      };
    }

    case 'run_import_with_mapping': {
      // Maps columns from a job and imports them
      const { pool } = await import('../db/pool');
      const { getSchema: getSchemaForImport } = await import('../schema/schema.service');
      const { processImport } = await import('../import/import.service');

      const { jobId, mapping } = args as { jobId: string; mapping: Record<string, string> };

      const jobResult = await pool.query(
        `SELECT metadata FROM background_jobs WHERE id = $1 AND tenant_id = $2`,
        [jobId, tenantId],
      );
      if (jobResult.rows.length === 0) throw new Error('Import job not found');

      const meta = jobResult.rows[0].metadata as { rows: Record<string, string>[] };
      const schema = await getSchemaForImport(tenantId);
      const summary = await processImport(tenantId, meta.rows, mapping, schema);

      return { imported: summary.imported, skipped: summary.skipped, errors: summary.errors.slice(0, 5) };
    }

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
  const profileSection = dataProfile
    ? `\nThe user has uploaded: **${dataProfile.filename}** (${dataProfile.rowCount} rows)\nColumns detected: ${dataProfile.columns.map(c => `${c.name} (${c.inferredType})`).join(', ')}\nSample values: ${dataProfile.columns.slice(0, 4).map(c => `${c.name}: [${c.sampleValues.slice(0, 3).join(', ')}]`).join(' | ')}`
    : '';

  return `You are an expert data system architect embedded in CellX — a no-code data platform.
Your goal is to help non-technical users (university faculty, warehouse managers, HR teams) set up their data system in 3 steps or fewer.
${profileSection}

IMPORTANT: Be conversational and simple. Never use technical terms like "JSONB", "UUID", "schema", "tenant", or "constraint rules".
Instead say: "column" not "field", "your data" not "records", "automation rule" not "constraint rule".

When a user uploads data, your job is to:
1. Confirm what you see in plain English ("I can see 45 faculty members with Name, Department, and Experience columns")
2. Ask ONE simple question about what they want to do
3. Ask 2-3 specific questions (numbers, choices) — never open-ended
4. Set everything up automatically using tools
5. Show a clear result: "Done! Here's what I built for you:"

You can call tools by responding with JSON in this format:
\`\`\`json
{"tool": "tool_name", "args": {...}}
\`\`\`

Available tools:
- list_fields() — see existing columns
- create_field(name, field_type: text|integer|float|date|status, dropdown_values?: string[]) — add a column
- delete_field(fieldId) — remove a column
- list_formulas() — see existing formulas
- create_formula(name, target_field_id, expression) — create formula using [fieldId] syntax
- delete_formula(formulaId) — remove a formula
- list_alert_rules() — see existing alerts
- create_alert_rule(name, target_field_id, operator: eq|neq|lt|gt|lte|gte, threshold, recipients: string[]) — create alert
- delete_alert_rule(ruleId) — remove an alert
- setup_solver_problem(resourceFieldId, experienceFieldId?, classrooms, slotsPerDay, examDays, juniorMax, midMax, seniorMax, noSimultaneous) — set up exam duty assignment
- run_import_with_mapping(jobId, mapping: {sourceColumn: fieldId}) — import data with column mapping

Domain knowledge:
- Exam duty: faculty → resources, exam rooms × time slots → slots, experience tiers → max_assignments constraints
- Calibration: last_calibrated + interval = next_due, status field with Safe/Warning/Danger/Overdue values
- Inventory: quantity < reorder_point → alert, stock_value = quantity × unit_price formula
- HR: leave_days > threshold → alert, salary formulas

Rules:
- Always call list_fields first before creating fields to avoid duplicates
- Use field IDs (UUIDs) when referencing fields in formulas and alerts
- Formula syntax: use [fieldId] to reference fields. Supports +, -, *, /, IF(), DATE_ADD()
- After completing setup, always say "Done! Here's what I built:" followed by a bullet list
- If the user seems confused, offer to undo everything and start over`;
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
