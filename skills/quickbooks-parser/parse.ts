/**
 * QuickBooks Trial Balance CSV Parser Skill
 *
 * Parses QuickBooks Desktop and QuickBooks Online trial balance / report exports
 * and converts them to the canonical GL_Actuals format.
 *
 * QuickBooks Format Characteristics:
 * - Account codes in parentheses: "Salaries Expense (6000)"
 * - Comma-formatted numbers: "85,000.00"
 * - Parenthetical negatives: "(1,234.56)" → -1234.56
 * - US date format: MM/DD/YYYY
 * - Natural-language headers: "Account", "Debit", "Credit", "Balance", "As of"
 * - Report preamble rows above column headers (skipped automatically)
 * - Subtotal/total rows (skipped automatically)
 * - Optional "Class" or "Location" column → entity
 *
 * Output: Period,Account,Amount[,Entity] matching GL_Actuals.csv import format
 */

export interface GLActualsRow {
  period: string;   // YYYY-MM
  account: string;  // GL account code
  amount: number;   // positive = debit/cost, negative = credit/reversal
  entity?: string;  // optional entity/division code
}

export interface TrialBalanceParseResult {
  data: GLActualsRow[];
  warnings: string[];
  metadata: {
    rowsExtracted: number;
    formatConfidence: number;
    transformationsApplied: string[];
    system: string;
  };
}

export interface ParseOptions {
  /** YYYY-MM period to use when CSV has no per-row date */
  defaultPeriod?: string;
  /** Entity/division code to tag all rows when not in the CSV */
  entityCode?: string;
  /** Map "Class" or "Location" column to entity (default: true) */
  classAsEntity?: boolean;
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
// Main parse function
// ---------------------------------------------------------------------------

export function parseQuickBooks(
  csvContent: string,
  options: ParseOptions = {}
): TrialBalanceParseResult {
  const warnings: string[] = [];
  const transformations: string[] = [];
  const useClass = options.classAsEntity !== false; // default true

  try {
    const rawLines = csvContent.split('\n');

    // Find the header row — first line with account-related column + amount column
    let headerIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const lower = rawLines[i].toLowerCase();
      if (
        lower.includes('account') &&
        (lower.includes('debit') || lower.includes('credit') || lower.includes('balance') || lower.includes('amount'))
      ) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      warnings.push('Could not locate column header row. Expected headers containing "Account" and "Debit"/"Credit"/"Balance".');
      return {
        data: [],
        warnings,
        metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'quickbooks' }
      };
    }

    if (headerIdx > 0) {
      // Try to extract report date from preamble
      const preamble = rawLines.slice(0, headerIdx).join('\n');
      const extractedPeriod = extractPeriodFromPreamble(preamble);
      if (extractedPeriod && !options.defaultPeriod) {
        options = { ...options, defaultPeriod: extractedPeriod };
        transformations.push(`Extracted period from report header: "${extractedPeriod}"`);
      }
      transformations.push(`Skipped ${headerIdx} preamble row(s)`);
    }

    const headers = parseCSVLine(rawLines[headerIdx]);
    const dataLines = rawLines.slice(headerIdx + 1).filter(l => l.trim());
    const confidence = validateQBFormat(headers);

    if (confidence < 0.4) {
      warnings.push(`Low confidence this is QuickBooks format (${Math.round(confidence * 100)}%)`);
      warnings.push(`Found headers: ${headers.join(', ')}`);
    }

    const data: GLActualsRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = headerIdx + i + 2;
      const values = parseCSVLine(dataLines[i]);
      if (values.every(v => !v.trim())) continue;

      // Skip total/subtotal/header rows
      const first = (values[0] ?? '').trim().toLowerCase();
      if (isSkipRow(first)) {
        transformations.push(`Skipped row: "${values[0]?.trim()}"`);
        continue;
      }

      try {
        const parsed = parseQBRow(headers, values, options, useClass, transformations);
        if (parsed) data.push(parsed);
      } catch (err: any) {
        warnings.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    const missingPeriod = data.filter(r => !r.period).length;
    if (missingPeriod > 0) {
      warnings.push(`${missingPeriod} row(s) have no period. Pass options.defaultPeriod = "YYYY-MM".`);
    }

    return {
      data: data.filter(r => r.period),
      warnings,
      metadata: {
        rowsExtracted: data.length,
        formatConfidence: confidence,
        transformationsApplied: transformations,
        system: 'quickbooks',
      }
    };
  } catch (err: any) {
    warnings.push(`Parse error: ${err.message}`);
    return {
      data: [],
      warnings,
      metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'quickbooks' }
    };
  }
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

function parseQBRow(
  headers: string[],
  values: string[],
  options: ParseOptions,
  useClass: boolean,
  transformations: string[]
): GLActualsRow | null {
  let account = '';
  let accountName = '';
  let debit = 0;
  let credit = 0;
  let balance: number | undefined;
  let period = options.defaultPeriod ?? '';
  let entity = options.entityCode ?? '';

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    const v = (values[i] ?? '').trim();

    if (h === 'account' || h === 'account name') {
      const extracted = extractAccountCode(v);
      account = extracted.code;
      accountName = extracted.name ?? v;
      if (extracted.code !== v) {
        transformations.push(`Extracted account code "${extracted.code}" from "${v}"`);
      }
    } else if (h === 'debit' || h === 'dr') {
      debit = parseQBNumber(v);
    } else if (h === 'credit' || h === 'cr') {
      credit = parseQBNumber(v);
    } else if (h === 'balance' || h === 'amount' || h === 'open balance') {
      balance = parseQBNumber(v);
    } else if (h === 'date' || h === 'as of' || h === 'period') {
      const p = parseQBDate(v);
      if (p) {
        period = p;
        if (v !== p) transformations.push(`Converted date "${v}" → "${p}"`);
      }
    } else if (useClass && (h === 'class' || h === 'location' || h === 'department')) {
      if (v && !entity) entity = v;
    }
  }

  if (!account) {
    if (accountName) {
      account = accountName;
    } else {
      throw new Error('Missing account code');
    }
  }

  let amount: number;
  if (debit !== 0 || credit !== 0) {
    amount = debit - credit;
    if (debit !== 0 && credit !== 0) {
      transformations.push(`Net for ${account}: Debit ${debit} - Credit ${credit} = ${amount}`);
    }
  } else if (balance !== undefined) {
    amount = balance;
  } else {
    throw new Error(`No amount for account "${account}"`);
  }

  if (amount === 0) return null;

  const row: GLActualsRow = { period, account, amount };
  if (entity) row.entity = entity;
  return row;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract code from "Account Name (Code)" parenthetical format */
function extractAccountCode(value: string): { code: string; name: string | null } {
  const match = value.match(/^(.+?)\s*\((\w[\w.\-]*)\)$/);
  if (match) {
    return { code: match[2].trim(), name: match[1].trim() };
  }
  return { code: value.trim(), name: null };
}

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

function parseQBNumber(value: string): number {
  if (!value || value.trim() === '') return 0;
  const isNeg = value.startsWith('(') && value.endsWith(')');
  const cleaned = value.replace(/[,()$\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : num;
}

function parseQBDate(value: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  const isoMatch = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  // MM/DD/YYYY (QuickBooks default)
  const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const month = mdyMatch[1].padStart(2, '0');
    return `${mdyMatch[3]}-${month}`;
  }
  return null;
}

const SKIP_PATTERNS = ['total', 'grand total', 'net income', 'net loss', 'subtotal', ''];
function isSkipRow(first: string): boolean {
  return SKIP_PATTERNS.includes(first) || first.startsWith('total ') || first.startsWith('grand ');
}

/**
 * Try to extract a reporting period from QB report header lines
 * e.g. "As of December 31, 2024" → "2024-12"
 */
function extractPeriodFromPreamble(preamble: string): string | null {
  // "As of MM/DD/YYYY"
  const asOfMatch = preamble.match(/as of\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (asOfMatch) {
    const month = asOfMatch[1].padStart(2, '0');
    return `${asOfMatch[3]}-${month}`;
  }
  // Month name: "December 2024" or "December 31, 2024"
  const months: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
    july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
  };
  const monthMatch = preamble.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b[^,\n]*?,?\s*(\d{4})/i);
  if (monthMatch) {
    const m = months[monthMatch[1].toLowerCase()];
    return `${monthMatch[2]}-${m}`;
  }
  return null;
}

function validateQBFormat(headers: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  let score = 0;
  if (lower.some(h => h === 'account' || h === 'account name')) score += 0.3;
  if (lower.some(h => h === 'debit' || h === 'dr')) score += 0.25;
  if (lower.some(h => h === 'credit' || h === 'cr')) score += 0.25;
  if (lower.some(h => h === 'balance' || h === 'open balance')) score += 0.1;
  if (lower.some(h => h === 'class' || h === 'as of')) score += 0.1;
  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export default function main(args: {
  csvContent: string;
  defaultPeriod?: string;
  entityCode?: string;
  classAsEntity?: boolean;
}) {
  const { csvContent, ...options } = args;
  const result = parseQuickBooks(csvContent, options);

  console.log('\nQuickBooks Trial Balance Parser Results\n');
  console.log(`System:             quickbooks`);
  console.log(`Rows extracted:     ${result.metadata.rowsExtracted}`);
  console.log(`Format confidence:  ${Math.round(result.metadata.formatConfidence * 100)}%`);

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
