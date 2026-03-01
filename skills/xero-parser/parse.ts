/**
 * Xero Trial Balance CSV Parser Skill
 *
 * Parses Xero trial balance / account transaction exports and converts them
 * to the canonical GL_Actuals format used by the Indirect Rates Forecast app.
 *
 * Xero Format Characteristics:
 * - Account code in "Account Code" or "Code" column (numeric or alphanumeric)
 * - YTD Debit / YTD Credit columns (net = Debit - Credit)
 * - Optional "Balance" or "Closing Balance" column
 * - Date format: DD/MM/YYYY (AU/NZ/UK) or YYYY-MM-DD (ISO)
 * - Numbers: comma-formatted "52,850.00"; parentheses for negatives "(1,234.56)"
 * - Report header rows above column headers (automatically skipped)
 * - "Total" and "Grand Total" rows (automatically skipped)
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
  /** YYYY-MM to assign when CSV has no per-row period (e.g. "2024-10") */
  defaultPeriod?: string;
  /** Entity/division code to tag all rows when not in the CSV */
  entityCode?: string;
  /** Use "Closing Balance" / "Balance" column instead of Debit-Credit net */
  useEndingBalance?: boolean;
}

/**
 * Convert GLActualsRow[] to importable CSV string
 */
export function toGLActualsCSV(data: GLActualsRow[]): string {
  const hasEntity = data.some(r => r.entity);
  const header = hasEntity ? 'Period,Account,Amount,Entity' : 'Period,Account,Amount';
  const rows = data.map(r => {
    const base = `${r.period},${r.account},${r.amount.toFixed(2)}`;
    return hasEntity ? `${base},${r.entity ?? ''}` : base;
  });
  return [header, ...rows].join('\n');
}

/**
 * Main parse function
 */
export function parseXero(
  csvContent: string,
  options: ParseOptions = {}
): TrialBalanceParseResult {
  const warnings: string[] = [];
  const transformations: string[] = [];

  try {
    const rawLines = csvContent.split('\n');

    // Find the header row — look for the first line containing an account-related keyword
    let headerIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const lower = rawLines[i].toLowerCase();
      if (
        lower.includes('account code') ||
        lower.includes('account name') ||
        (lower.includes('account') && (lower.includes('debit') || lower.includes('credit') || lower.includes('balance')))
      ) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      warnings.push('Could not locate column header row. Expected headers containing "Account Code", "YTD Debit", etc.');
      return {
        data: [],
        warnings,
        metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'xero' }
      };
    }

    // Skip any preamble rows (report title, date range, etc.)
    if (headerIdx > 0) {
      transformations.push(`Skipped ${headerIdx} header/preamble row(s) before column headers`);
    }

    const headers = parseCSVLine(rawLines[headerIdx]);
    const dataLines = rawLines.slice(headerIdx + 1).filter(l => l.trim());

    const confidence = validateXeroFormat(headers);
    if (confidence < 0.4) {
      warnings.push(`Low confidence this is Xero format (${Math.round(confidence * 100)}%). Expected headers like: Account Code, YTD Debit, YTD Credit`);
      warnings.push(`Found: ${headers.join(', ')}`);
    }

    const data: GLActualsRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = headerIdx + i + 2;
      const values = parseCSVLine(dataLines[i]);

      if (values.length === 0 || values.every(v => !v.trim())) continue;

      // Skip total/subtotal rows
      const firstVal = (values[0] || '').toLowerCase().trim();
      if (
        firstVal === 'total' ||
        firstVal === 'grand total' ||
        firstVal.startsWith('total ') ||
        firstVal === ''
      ) {
        const rowLabel = values.find(v => v.trim()) ?? '';
        if (rowLabel) transformations.push(`Skipped total row: "${rowLabel}"`);
        continue;
      }

      try {
        const parsed = parseXeroRow(headers, values, options, transformations);
        if (parsed) data.push(parsed);
      } catch (err: any) {
        warnings.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    if (data.length > 0 && !options.defaultPeriod) {
      const missing = data.filter(r => !r.period).length;
      if (missing > 0) {
        warnings.push(
          `${missing} row(s) have no period. Pass options.defaultPeriod = "YYYY-MM" to assign one, or ensure the CSV has a Date/Period column.`
        );
      }
    }

    return {
      data: data.filter(r => r.period), // drop rows with no period
      warnings,
      metadata: {
        rowsExtracted: data.length,
        formatConfidence: confidence,
        transformationsApplied: transformations,
        system: 'xero',
      }
    };
  } catch (err: any) {
    warnings.push(`Parse error: ${err.message}`);
    return {
      data: [],
      warnings,
      metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'xero' }
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function parseXeroRow(
  headers: string[],
  values: string[],
  options: ParseOptions,
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

    if (h === 'account code' || h === 'code') {
      account = v;
    } else if (h === 'account name' || h === 'name' || h === 'description' || h === 'account') {
      accountName = v;
    } else if (h === 'ytd debit' || h === 'debit' || h === 'dr') {
      debit = parseXeroNumber(v);
    } else if (h === 'ytd credit' || h === 'credit' || h === 'cr') {
      credit = parseXeroNumber(v);
    } else if (
      (!options.useEndingBalance && (h === 'balance' || h === 'closing balance' || h === 'net')) ||
      (options.useEndingBalance && (h === 'balance' || h === 'closing balance'))
    ) {
      balance = parseXeroNumber(v);
    } else if (h === 'date' || h === 'period' || h === 'as of') {
      const parsed = parseXeroDate(v);
      if (parsed) {
        period = parsed;
        if (v !== parsed) transformations.push(`Converted date: "${v}" → "${parsed}"`);
      }
    } else if (h === 'tracking' || h === 'class' || h === 'location' || h === 'department') {
      if (v && !entity) entity = v;
    }
  }

  // Fall back: if no code found, try using account name as identifier
  if (!account && accountName) {
    account = accountName;
    transformations.push(`No account code column found; using account name as identifier: "${accountName}"`);
  }

  if (!account) throw new Error('Missing account code');

  // Calculate amount
  let amount: number;
  if (options.useEndingBalance && balance !== undefined) {
    amount = balance;
    transformations.push(`Using ending balance for ${account}: ${amount}`);
  } else if (debit !== 0 || credit !== 0) {
    amount = debit - credit;
    if (debit !== 0 && credit !== 0) {
      transformations.push(`Net for ${account}: Debit ${debit} - Credit ${credit} = ${amount}`);
    }
  } else if (balance !== undefined) {
    amount = balance;
    transformations.push(`Using balance column for ${account}: ${amount}`);
  } else {
    throw new Error(`No amount data for account "${account}"`);
  }

  if (amount === 0) return null; // skip zero-balance rows silently

  const row: GLActualsRow = { period, account, amount };
  if (entity) row.entity = entity;
  return row;
}

/**
 * Parse CSV line, handling quoted fields with embedded commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result.map(v => v.replace(/^"|"$/g, ''));
}

/**
 * Parse Xero number format
 * Handles: "52,850.00", "(1,234.56)" (negative), "-125,000.00", ""
 */
function parseXeroNumber(value: string): number {
  if (!value || value.trim() === '') return 0;

  const isNeg = value.startsWith('(') && value.endsWith(')');
  const cleaned = value.replace(/[,()]/g, '').trim();
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : num;
}

/**
 * Parse Xero date to YYYY-MM period
 * Handles: "31/12/2024" (DD/MM/YYYY), "2024-12-31" (ISO), "2024-12" (already period)
 */
function parseXeroDate(value: string): string | null {
  if (!value) return null;

  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(value)) return value;

  // ISO YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  // DD/MM/YYYY (Xero AU/NZ/UK default)
  const dmyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}`;
  }

  // MM/DD/YYYY (US format some Xero regions use)
  const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    // Ambiguous — treat as DD/MM first (Xero default)
    const month = mdyMatch[2].padStart(2, '0');
    const year = mdyMatch[3];
    return `${year}-${month}`;
  }

  return null;
}

/**
 * Validate headers as Xero format, return confidence 0-1
 */
function validateXeroFormat(headers: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  let score = 0;

  if (lower.some(h => h === 'account code' || h === 'code')) score += 0.3;
  if (lower.some(h => h === 'ytd debit' || h === 'ytd credit')) score += 0.5;
  if (lower.some(h => h === 'account name' || h === 'name')) score += 0.1;
  if (lower.some(h => h === 'balance' || h === 'closing balance')) score += 0.1;

  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export default function main(args: {
  csvContent: string;
  defaultPeriod?: string;
  entityCode?: string;
  useEndingBalance?: boolean;
}) {
  const { csvContent, ...options } = args;
  const result = parseXero(csvContent, options);

  console.log('\nXero Trial Balance Parser Results\n');
  console.log(`System:             xero`);
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
