/**
 * Generic Auto-Detecting Trial Balance CSV Parser Skill
 *
 * Parses trial balance exports from any accounting system by auto-detecting
 * column roles, date formats, and sign conventions.
 *
 * Detection priority:
 *   1. User-provided column overrides (accountColumn, amountColumn, etc.)
 *   2. Exact header name matches against known column names
 *   3. Fuzzy/partial header matching
 *   4. Fallback warnings when detection fails
 *
 * Supports:
 *   - Debit + Credit column pairs (net = Debit - Credit)
 *   - Single Balance / Net / Amount column
 *   - Parenthetical negatives "(1,234.56)" or leading minus "-1234.56"
 *   - Date formats: MM/DD/YYYY, DD/MM/YYYY, MM/YYYY, YYYY-MM, YYYY-MM-DD, month names
 *   - Entity from Organization, Company, Subsidiary, Division, Class columns
 *
 * Output: Period,Account,Amount[,Entity] matching GL_Actuals.csv import format
 */

export interface GLActualsRow {
  period: string;
  account: string;
  amount: number;
  entity?: string;
}

export interface DetectedFormat {
  accountColumn: string;
  amountSource: 'debit_credit' | 'balance' | 'net_change' | 'amount';
  dateFormat: string;
  entityColumn: string | null;
}

export interface TrialBalanceParseResult {
  data: GLActualsRow[];
  warnings: string[];
  metadata: {
    rowsExtracted: number;
    formatConfidence: number;
    transformationsApplied: string[];
    system: string;
    detectedFormat: DetectedFormat;
  };
}

export interface ParseOptions {
  defaultPeriod?: string;
  entityCode?: string;
  /** 'parentheses' | 'minus' | 'credit_column' | 'auto' */
  negativeConvention?: 'parentheses' | 'minus' | 'credit_column' | 'auto';
  /** 'mdy' | 'dmy' | 'iso' | 'auto' — hint for ambiguous dates */
  dateFormatHint?: 'mdy' | 'dmy' | 'iso' | 'auto';
  /** Override: exact header name of the account code column */
  accountColumn?: string;
  /** Override: exact header name of the preferred amount column */
  amountColumn?: string;
  /** Override: exact header name of the period/date column */
  periodColumn?: string;
}

export function toGLActualsCSV(data: GLActualsRow[]): string {
  const hasEntity = data.some(r => r.entity);
  const header = hasEntity ? 'Period,Account,Amount,Entity' : 'Period,Account,Amount';
  const rows = data.map(r => {
    const base = `${r.period},${r.account},${r.amount.toFixed(2)}`;
    return hasEntity ? `${base},${r.entity ?? ''}` : base;
  });
  return [header, ...rows].join('\n');
}

// ---------------------------------------------------------------------------
// Column name libraries (priority order)
// ---------------------------------------------------------------------------

const ACCOUNT_COLS = [
  'account code', 'account number', 'account no', 'acct number', 'acct no',
  'gl account', 'account #', 'acct #', 'account', 'acct', 'code',
];

const DEBIT_COLS = [
  'debit amount', 'ytd debit', 'debit amount (base currency)', 'dr amount',
  'debit', 'dr', 'debits',
];

const CREDIT_COLS = [
  'credit amount', 'ytd credit', 'credit amount (base currency)', 'cr amount',
  'credit', 'cr', 'credits',
];

const BALANCE_COLS = [
  'ending balance', 'closing balance', 'end balance', 'ytd balance', 'balance',
];

const NET_CHANGE_COLS = [
  'net change', 'net activity', 'net amount', 'activity', 'net',
];

const AMOUNT_COLS = [
  'amount (base currency)', 'base currency amount', 'amount', 'open balance',
];

const PERIOD_COLS = [
  'posting period', 'fiscal period', 'accounting period', 'fiscal_period',
  'accounting_period', 'period', 'month', 'date', 'as of', 'transaction date',
];

const ENTITY_COLS = [
  'subsidiary', 'legal entity', 'organization', 'org', 'company', 'division',
  'entity', 'location', 'class', 'department',
];

// ---------------------------------------------------------------------------
// Main parse function
// ---------------------------------------------------------------------------

export function parseGeneric(
  csvContent: string,
  options: ParseOptions = {}
): TrialBalanceParseResult {
  const warnings: string[] = [];
  const transformations: string[] = [];
  const dateHint = options.dateFormatHint ?? 'auto';

  try {
    const rawLines = csvContent.split('\n');

    // Find header row
    let headerIdx = findHeaderRow(rawLines);
    if (headerIdx === -1) {
      warnings.push('Could not locate a column header row. CSV must have recognizable column names.');
      return {
        data: [],
        warnings,
        metadata: {
          rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [],
          system: 'generic',
          detectedFormat: { accountColumn: '', amountSource: 'amount', dateFormat: 'unknown', entityColumn: null }
        }
      };
    }

    if (headerIdx > 0) {
      const preamble = rawLines.slice(0, headerIdx).join('\n');
      const p = extractPeriodFromPreamble(preamble, dateHint);
      if (p && !options.defaultPeriod) {
        options = { ...options, defaultPeriod: p };
        transformations.push(`Extracted period from report header: "${p}"`);
      }
      transformations.push(`Skipped ${headerIdx} preamble row(s) before column headers`);
    }

    const headers = parseCSVLine(rawLines[headerIdx]);
    const dataLines = rawLines.slice(headerIdx + 1).filter(l => l.trim());

    // Detect column roles
    const detected = detectColumns(headers, options);
    transformations.push(`Detected account column: "${detected.accountColumn}"`);
    transformations.push(`Detected amount source: ${detected.amountSource}`);
    if (detected.entityColumn) transformations.push(`Detected entity column: "${detected.entityColumn}"`);
    transformations.push(`Detected date format: ${detected.dateFormat}`);

    if (!detected.accountColumn) {
      warnings.push(`Could not detect an account code column. Tried: ${ACCOUNT_COLS.slice(0, 5).join(', ')}, etc.`);
      warnings.push('Pass options.accountColumn = "YourColumnName" to override.');
      return {
        data: [],
        warnings,
        metadata: {
          rowsExtracted: 0, formatConfidence: 0, transformationsApplied: transformations,
          system: 'generic', detectedFormat: detected
        }
      };
    }

    const confidence = scoreDetectionConfidence(detected);
    if (confidence < 0.5) {
      warnings.push(`Low detection confidence (${Math.round(confidence * 100)}%). Review the detected columns above.`);
    }

    const data: GLActualsRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = headerIdx + i + 2;
      const values = parseCSVLine(dataLines[i]);
      if (values.every(v => !v.trim())) continue;

      if (isSkipRow(values, headers, detected.accountColumn)) {
        continue;
      }

      try {
        const parsed = parseGenericRow(headers, values, detected, options, dateHint, transformations);
        if (parsed) data.push(parsed);
      } catch (err: any) {
        warnings.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    const missingPeriod = data.filter(r => !r.period).length;
    if (missingPeriod > 0) {
      warnings.push(
        `${missingPeriod} row(s) have no period. ` +
        `Pass options.defaultPeriod = "YYYY-MM" or ensure a date/period column is present.`
      );
    }

    return {
      data: data.filter(r => r.period),
      warnings,
      metadata: {
        rowsExtracted: data.length,
        formatConfidence: confidence,
        transformationsApplied: transformations,
        system: 'generic',
        detectedFormat: detected,
      }
    };
  } catch (err: any) {
    warnings.push(`Parse error: ${err.message}`);
    return {
      data: [],
      warnings,
      metadata: {
        rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [],
        system: 'generic',
        detectedFormat: { accountColumn: '', amountSource: 'amount', dateFormat: 'unknown', entityColumn: null }
      }
    };
  }
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

function parseGenericRow(
  headers: string[],
  values: string[],
  detected: DetectedFormat,
  options: ParseOptions,
  dateHint: string,
  transformations: string[]
): GLActualsRow | null {
  const get = (colName: string): string => {
    const idx = headers.findIndex(h => h.toLowerCase().trim() === colName.toLowerCase());
    return idx !== -1 ? (values[idx] ?? '').trim() : '';
  };

  const account = get(detected.accountColumn);
  if (!account) throw new Error('Empty account code');

  // Amount
  let amount: number;
  if (detected.amountSource === 'debit_credit') {
    const debitCol = findFirst(headers, DEBIT_COLS);
    const creditCol = findFirst(headers, CREDIT_COLS);
    const debit = parseGenericNumber(get(debitCol), 'parentheses');
    const credit = parseGenericNumber(get(creditCol), 'parentheses');
    amount = debit - credit;
    if (debit !== 0 && credit !== 0) {
      transformations.push(`Net for ${account}: ${debit} - ${credit} = ${amount}`);
    }
  } else if (detected.amountSource === 'balance') {
    const balCol = findFirst(headers, BALANCE_COLS);
    amount = parseGenericNumber(get(balCol), options.negativeConvention ?? 'auto');
  } else if (detected.amountSource === 'net_change') {
    const netCol = findFirst(headers, NET_CHANGE_COLS);
    amount = parseGenericNumber(get(netCol), options.negativeConvention ?? 'auto');
  } else {
    // 'amount'
    const amtCol = options.amountColumn ?? findFirst(headers, AMOUNT_COLS);
    amount = parseGenericNumber(get(amtCol), options.negativeConvention ?? 'auto');
  }

  // Period
  let period = options.defaultPeriod ?? '';
  if (detected.dateFormat !== 'unknown' || detected.dateFormat === '') {
    const periodCol = options.periodColumn ?? findFirst(headers, PERIOD_COLS);
    if (periodCol) {
      const raw = get(periodCol);
      const parsed = parseGenericDate(raw, dateHint);
      if (parsed) {
        period = parsed;
        if (raw !== parsed) transformations.push(`Period "${raw}" → "${parsed}"`);
      }
    }
  }

  // Entity
  let entity = options.entityCode ?? '';
  if (!entity && detected.entityColumn) {
    entity = get(detected.entityColumn);
  }

  if (amount === 0) return null;

  const row: GLActualsRow = { period, account, amount };
  if (entity) row.entity = entity;
  return row;
}

// ---------------------------------------------------------------------------
// Column detection
// ---------------------------------------------------------------------------

function detectColumns(headers: string[], options: ParseOptions): DetectedFormat {
  const lower = headers.map(h => h.toLowerCase().trim());

  // Account column
  const accountColumn = options.accountColumn
    ? options.accountColumn
    : findFirst(headers, ACCOUNT_COLS);

  // Amount source: prefer debit+credit pair
  const hasDebit = findFirst(headers, DEBIT_COLS) !== '';
  const hasCredit = findFirst(headers, CREDIT_COLS) !== '';
  const hasBalance = findFirst(headers, BALANCE_COLS) !== '';
  const hasNetChange = findFirst(headers, NET_CHANGE_COLS) !== '';
  const hasAmount = findFirst(headers, AMOUNT_COLS) !== '';

  let amountSource: DetectedFormat['amountSource'];
  if (hasDebit && hasCredit) {
    amountSource = 'debit_credit';
  } else if (hasBalance) {
    amountSource = 'balance';
  } else if (hasNetChange) {
    amountSource = 'net_change';
  } else if (hasAmount) {
    amountSource = 'amount';
  } else {
    amountSource = 'amount'; // fallback
  }

  // Entity column
  const entityColumn = findFirst(headers, ENTITY_COLS) || null;

  // Date format: sample first data-looking value from period column
  const periodCol = findFirst(headers, PERIOD_COLS);
  const dateFormat = periodCol ? 'detected' : 'unknown';

  return { accountColumn, amountSource, dateFormat, entityColumn };
}

function findFirst(headers: string[], candidates: string[]): string {
  const lower = headers.map(h => h.toLowerCase().trim());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  // Partial match fallback
  for (const candidate of candidates) {
    const idx = lower.findIndex(h => h.includes(candidate.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return '';
}

function scoreDetectionConfidence(detected: DetectedFormat): number {
  let score = 0;
  if (detected.accountColumn) score += 0.4;
  if (detected.amountSource === 'debit_credit') score += 0.4;
  else if (detected.amountSource === 'balance' || detected.amountSource === 'amount') score += 0.3;
  if (detected.dateFormat !== 'unknown') score += 0.1;
  if (detected.entityColumn) score += 0.1;
  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// Header / preamble detection
// ---------------------------------------------------------------------------

function findHeaderRow(lines: string[]): number {
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const lower = lines[i].toLowerCase();
    const hasAccount = ACCOUNT_COLS.some(c => lower.includes(c.toLowerCase()));
    const hasAmount = (
      DEBIT_COLS.some(c => lower.includes(c.toLowerCase())) ||
      CREDIT_COLS.some(c => lower.includes(c.toLowerCase())) ||
      BALANCE_COLS.some(c => lower.includes(c.toLowerCase())) ||
      AMOUNT_COLS.some(c => lower.includes(c.toLowerCase())) ||
      NET_CHANGE_COLS.some(c => lower.includes(c.toLowerCase()))
    );
    if (hasAccount && hasAmount) return i;
  }
  return -1;
}

function isSkipRow(values: string[], headers: string[], accountCol: string): boolean {
  const first = (values[0] ?? '').trim().toLowerCase();
  if (!first) return true;
  const totalPrefixes = ['total', 'grand total', 'subtotal', 'net income', 'net loss', '---'];
  if (totalPrefixes.some(p => first.startsWith(p))) return true;

  // Check account column specifically
  const acctIdx = headers.findIndex(h => h.toLowerCase().trim() === accountCol.toLowerCase().trim());
  if (acctIdx !== -1) {
    const acctVal = (values[acctIdx] ?? '').trim().toLowerCase();
    if (!acctVal || totalPrefixes.some(p => acctVal.startsWith(p))) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Number parsing
// ---------------------------------------------------------------------------

function parseGenericNumber(
  value: string,
  convention: string
): number {
  if (!value || value.trim() === '' || value.trim() === '-') return 0;

  const isParenNeg = value.startsWith('(') && value.endsWith(')');
  const cleaned = value.replace(/[,()$\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;

  if (isParenNeg) return -Math.abs(num);
  return num;
}

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

const MONTH_MAP: Record<string, string> = {
  jan: '01', january: '01', feb: '02', february: '02',
  mar: '03', march: '03', apr: '04', april: '04',
  may: '05', jun: '06', june: '06', jul: '07', july: '07',
  aug: '08', august: '08', sep: '09', sept: '09', september: '09',
  oct: '10', october: '10', nov: '11', november: '11',
  dec: '12', december: '12',
};

function parseGenericDate(value: string, hint: string): string | null {
  if (!value) return null;

  // YYYY-MM already
  if (/^\d{4}-\d{2}$/.test(value)) return value;

  // ISO YYYY-MM-DD
  const isoFull = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoFull) return `${isoFull[1]}-${isoFull[2]}`;

  // MM/YYYY (month/year without day)
  const mmYYYY = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1].padStart(2, '0')}`;

  // Slash date with 3 parts — ambiguous MM/DD/YYYY vs DD/MM/YYYY
  const slashMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const a = parseInt(slashMatch[1], 10);
    const b = parseInt(slashMatch[2], 10);
    const year = slashMatch[3];
    if (hint === 'dmy' || (hint === 'auto' && a > 12)) {
      // DD/MM/YYYY
      return `${year}-${String(b).padStart(2, '0')}`;
    } else {
      // MM/DD/YYYY (default for US systems)
      return `${year}-${String(a).padStart(2, '0')}`;
    }
  }

  // Month name formats: "October 2024", "Oct-2024", "Oct 2024"
  const monthNameMatch = value.match(/^([a-z]+)[- ](\d{4})$/i);
  if (monthNameMatch) {
    const m = MONTH_MAP[monthNameMatch[1].toLowerCase()];
    if (m) return `${monthNameMatch[2]}-${m}`;
  }

  // "2024 October", "2024-Oct"
  const yearFirstMatch = value.match(/^(\d{4})[- ]([a-z]+)$/i);
  if (yearFirstMatch) {
    const m = MONTH_MAP[yearFirstMatch[2].toLowerCase()];
    if (m) return `${yearFirstMatch[1]}-${m}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Period from preamble
// ---------------------------------------------------------------------------

function extractPeriodFromPreamble(preamble: string, hint: string): string | null {
  // Try each date pattern in the preamble
  const patterns = [
    /(\d{4})-(\d{2})-\d{2}/,        // ISO
    /(\d{1,2})\/(\d{1,2})\/(\d{4})/, // slash
  ];

  for (const pat of patterns) {
    const m = preamble.match(pat);
    if (m) {
      if (m.length === 3) return `${m[1]}-${m[2]}`; // ISO
      if (m.length === 4) {
        const a = parseInt(m[1], 10);
        const year = m[3];
        if (hint === 'dmy' || (hint === 'auto' && a > 12)) {
          return `${year}-${m[2].padStart(2, '0')}`;
        }
        return `${year}-${m[1].padStart(2, '0')}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// CSV line parser
// ---------------------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result.map(v => v.replace(/^"|"$/g, ''));
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export default function main(args: {
  csvContent: string;
  defaultPeriod?: string;
  entityCode?: string;
  negativeConvention?: 'parentheses' | 'minus' | 'credit_column' | 'auto';
  dateFormatHint?: 'mdy' | 'dmy' | 'iso' | 'auto';
  accountColumn?: string;
  amountColumn?: string;
  periodColumn?: string;
}) {
  const { csvContent, ...options } = args;
  const result = parseGeneric(csvContent, options);

  console.log('\nGeneric Trial Balance Parser Results\n');
  console.log(`System:             generic (auto-detect)`);
  console.log(`Rows extracted:     ${result.metadata.rowsExtracted}`);
  console.log(`Format confidence:  ${Math.round(result.metadata.formatConfidence * 100)}%`);

  const fmt = result.metadata.detectedFormat;
  console.log(`\nDetected format:`);
  console.log(`  Account column:   ${fmt.accountColumn || '(not found)'}`);
  console.log(`  Amount source:    ${fmt.amountSource}`);
  console.log(`  Date format:      ${fmt.dateFormat}`);
  console.log(`  Entity column:    ${fmt.entityColumn || '(none)'}`);

  if (result.warnings.length > 0) {
    console.log('\nWarnings:');
    result.warnings.forEach(w => console.log(`  - ${w}`));
  }

  if (result.metadata.transformationsApplied.length > 0) {
    console.log('\nTransformations (first 5):');
    result.metadata.transformationsApplied.slice(0, 5).forEach(t => console.log(`  - ${t}`));
    if (result.metadata.transformationsApplied.length > 5) {
      console.log(`  ... and ${result.metadata.transformationsApplied.length - 5} more`);
    }
  }

  console.log('\nGL_Actuals CSV Output:');
  console.log(toGLActualsCSV(result.data));

  return result;
}
