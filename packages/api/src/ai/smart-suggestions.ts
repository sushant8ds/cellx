/**
 * SmartSuggestions — pattern-based domain detector
 * Analyzes column names and sample values to suggest what the user can build.
 * Rule-based heuristics first, LLM fallback for unknown patterns.
 */

export interface DomainSuggestion {
  id: string;
  icon: string;
  title: string;
  description: string;
  /** Pre-filled questions to ask the user before running the solver/AI */
  questions: SuggestionQuestion[];
  /** Which AI tool to invoke after questions are answered */
  primaryAction: 'setup_solver_problem' | 'setup_tracker' | 'setup_alerts';
}

export interface SuggestionQuestion {
  id: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'multiselect' | 'toggle';
  placeholder?: string;
  options?: string[];
  defaultValue?: string | number | boolean;
  required: boolean;
}

// ---------------------------------------------------------------------------
// Domain patterns
// ---------------------------------------------------------------------------

interface DomainPattern {
  keywords: string[];
  suggestion: DomainSuggestion;
}

const DOMAIN_PATTERNS: DomainPattern[] = [
  // ── Exam / Faculty duty assignment ──────────────────────────────────────
  {
    keywords: ['faculty', 'teacher', 'professor', 'lecturer', 'invigilator', 'designation', 'department', 'experience', 'years', 'exam', 'duty'],
    suggestion: {
      id: 'exam-duty',
      icon: '🎓',
      title: 'Assign Examination Duties',
      description: 'Automatically distribute invigilation duties across faculty based on experience tiers',
      primaryAction: 'setup_solver_problem',
      questions: [
        { id: 'classrooms', label: 'How many exam rooms / classrooms are available?', type: 'number', placeholder: '10', defaultValue: 10, required: true },
        { id: 'slots_per_day', label: 'How many time slots per day?', type: 'select', options: ['1', '2', '3', '4'], defaultValue: '3', required: true },
        { id: 'exam_days', label: 'How many days does the exam run?', type: 'number', placeholder: '4', defaultValue: 4, required: true },
        { id: 'junior_duties', label: 'Max duties for junior faculty (0–5 yrs exp)', type: 'number', defaultValue: 5, required: true },
        { id: 'mid_duties', label: 'Max duties for mid-level faculty (5–15 yrs)', type: 'number', defaultValue: 3, required: true },
        { id: 'senior_duties', label: 'Max duties for senior faculty (15+ yrs)', type: 'number', defaultValue: 1, required: true },
        { id: 'no_simultaneous', label: 'No person in two rooms at the same time', type: 'toggle', defaultValue: true, required: false },
      ],
    },
  },

  // ── Student attendance ───────────────────────────────────────────────────
  {
    keywords: ['student', 'roll', 'attendance', 'present', 'absent', 'class', 'section', 'subject', 'marks', 'grade'],
    suggestion: {
      id: 'student-attendance',
      icon: '📚',
      title: 'Track Student Attendance',
      description: 'Monitor attendance, flag low-attendance students, and generate reports',
      primaryAction: 'setup_tracker',
      questions: [
        { id: 'threshold', label: 'Minimum attendance % before alert', type: 'number', defaultValue: 75, required: true },
        { id: 'alert_email', label: 'Email to notify when attendance drops below threshold', type: 'text', placeholder: 'admin@school.edu', required: false },
      ],
    },
  },

  // ── Medicine / Pharma inventory ──────────────────────────────────────────
  {
    keywords: ['medicine', 'drug', 'batch', 'expiry', 'stock', 'pharmacy', 'tablet', 'capsule', 'dosage', 'manufacturer', 'mrp'],
    suggestion: {
      id: 'medicine-inventory',
      icon: '💊',
      title: 'Medicine Inventory & Expiry Monitor',
      description: 'Track stock levels, flag expiring batches, and alert on low inventory',
      primaryAction: 'setup_alerts',
      questions: [
        { id: 'low_stock_threshold', label: 'Alert when stock quantity falls below', type: 'number', defaultValue: 50, required: true },
        { id: 'expiry_warning_days', label: 'Warn when expiry is within X days', type: 'number', defaultValue: 90, required: true },
        { id: 'alert_email', label: 'Alert email address', type: 'text', placeholder: 'pharmacist@hospital.com', required: false },
      ],
    },
  },

  // ── Equipment calibration ────────────────────────────────────────────────
  {
    keywords: ['calibration', 'equipment', 'machine', 'device', 'gauge', 'instrument', 'last_calibrated', 'next_due', 'status', 'overdue'],
    suggestion: {
      id: 'calibration-tracker',
      icon: '⚙️',
      title: 'Equipment Calibration Tracker',
      description: 'Calculate next calibration dates, flag overdue equipment, and send alerts',
      primaryAction: 'setup_alerts',
      questions: [
        { id: 'calibration_interval', label: 'Calibration interval (days)', type: 'number', defaultValue: 365, required: true },
        { id: 'warning_days', label: 'Warn X days before due date', type: 'number', defaultValue: 30, required: true },
        { id: 'alert_email', label: 'Alert email address', type: 'text', placeholder: 'maintenance@company.com', required: false },
      ],
    },
  },

  // ── HR / Employee ────────────────────────────────────────────────────────
  {
    keywords: ['employee', 'staff', 'hr', 'payroll', 'salary', 'leave', 'joining', 'department', 'designation', 'performance'],
    suggestion: {
      id: 'hr-tracker',
      icon: '👥',
      title: 'Employee & HR Tracker',
      description: 'Track employee data, leaves, and performance with automated alerts',
      primaryAction: 'setup_tracker',
      questions: [
        { id: 'leave_threshold', label: 'Alert when leave days exceed', type: 'number', defaultValue: 20, required: false },
        { id: 'alert_email', label: 'HR alert email', type: 'text', placeholder: 'hr@company.com', required: false },
      ],
    },
  },

  // ── Sales / Lead pipeline ────────────────────────────────────────────────
  {
    keywords: ['lead', 'sales', 'pipeline', 'deal', 'revenue', 'customer', 'prospect', 'stage', 'close', 'opportunity'],
    suggestion: {
      id: 'sales-pipeline',
      icon: '📈',
      title: 'Sales Pipeline Tracker',
      description: 'Track leads through stages, calculate deal values, and alert on stale opportunities',
      primaryAction: 'setup_tracker',
      questions: [
        { id: 'stale_days', label: 'Alert when a deal has no activity for X days', type: 'number', defaultValue: 14, required: false },
        { id: 'alert_email', label: 'Sales alert email', type: 'text', placeholder: 'sales@company.com', required: false },
      ],
    },
  },

  // ── Inventory / Operations ───────────────────────────────────────────────
  {
    keywords: ['inventory', 'stock', 'sku', 'product', 'warehouse', 'quantity', 'reorder', 'supplier', 'vendor'],
    suggestion: {
      id: 'inventory',
      icon: '📦',
      title: 'Inventory Management',
      description: 'Track stock levels, set reorder alerts, and monitor supplier performance',
      primaryAction: 'setup_alerts',
      questions: [
        { id: 'reorder_threshold', label: 'Reorder alert when quantity falls below', type: 'number', defaultValue: 100, required: true },
        { id: 'alert_email', label: 'Procurement alert email', type: 'text', placeholder: 'procurement@company.com', required: false },
      ],
    },
  },

  // ── Patient / Healthcare ─────────────────────────────────────────────────
  {
    keywords: ['patient', 'diagnosis', 'doctor', 'ward', 'admission', 'discharge', 'treatment', 'prescription', 'hospital'],
    suggestion: {
      id: 'patient-records',
      icon: '🏥',
      title: 'Patient Records Tracker',
      description: 'Manage patient data, track admissions, and set follow-up alerts',
      primaryAction: 'setup_tracker',
      questions: [
        { id: 'followup_days', label: 'Follow-up alert after X days post-discharge', type: 'number', defaultValue: 7, required: false },
        { id: 'alert_email', label: 'Alert email', type: 'text', placeholder: 'admin@hospital.com', required: false },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Generic fallback suggestion
// ---------------------------------------------------------------------------

function genericSuggestion(columns: string[]): DomainSuggestion {
  const first = columns[0] ?? 'data';
  return {
    id: 'generic-tracker',
    icon: '📊',
    title: 'Track & Analyze Your Data',
    description: `Set up filters, formulas, and alerts for your ${first} dataset`,
    primaryAction: 'setup_tracker',
    questions: [
      { id: 'alert_field', label: 'Which column should trigger alerts?', type: 'select', options: columns, required: false },
      { id: 'alert_email', label: 'Alert email address', type: 'text', placeholder: 'you@example.com', required: false },
    ],
  };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export interface SmartSuggestionsResult {
  /** Primary suggestion (best match) */
  primary: DomainSuggestion;
  /** Up to 2 alternative suggestions */
  alternatives: DomainSuggestion[];
  /** Confidence score 0–1 */
  confidence: number;
}

export function getSmartSuggestions(
  columns: string[],
  sampleValues: Record<string, string[]> = {},
): SmartSuggestionsResult {
  const normalizedCols = columns.map(c => c.toLowerCase().replace(/[^a-z0-9]/g, '_'));

  // Score each pattern
  const scored = DOMAIN_PATTERNS.map(pattern => {
    let score = 0;
    for (const keyword of pattern.keywords) {
      for (const col of normalizedCols) {
        if (col.includes(keyword) || keyword.includes(col)) score++;
      }
      // Also check sample values
      for (const vals of Object.values(sampleValues)) {
        for (const val of vals) {
          if (val.toLowerCase().includes(keyword)) score += 0.5;
        }
      }
    }
    return { pattern, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const confidence = best.score > 0 ? Math.min(best.score / 5, 1) : 0;

  if (confidence < 0.2) {
    return {
      primary: genericSuggestion(columns),
      alternatives: [],
      confidence: 0,
    };
  }

  const alternatives = scored
    .slice(1, 3)
    .filter(s => s.score > 0)
    .map(s => s.pattern.suggestion);

  return {
    primary: best.pattern.suggestion,
    alternatives,
    confidence,
  };
}
