/**
 * Unanet Trial Balance CSV Parser Skill
 *
 * Parses Unanet (and Deltek Unanet) GL summary and trial balance exports,
 * converting them to the canonical GL_Actuals format.
 *
 * Unanet Format Characteristics:
 * - Columns: Account Number, Account Name, (Beginning Balance), Debits, Credits, (Net Change), Ending Balance
 * - Period may be a month number (1-12) in one column + Year in another
 * - Period may be a month name ("October") or full YYYY-MM
 * - Organization / Company column → entity field
 * - Comma-formatted numbers; parentheses or minus sign for negatives
 * - Total and subtotal rows (automatically skipped)
 *
 * Output: Period,Account,Amount[,Entity] matching GL_Actuals.csv import format
 */

export interface GLActualsRow {
  period: string;
  account: string;
  amount: number;
  entity?: string;
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
  /** YYYY-MM to use when the CSV has no date/period column */
  defaultPeriod?: string;
  /** Entity code to tag all rows when not in the CSV */
  entityCode?: string;
  /**
   * Fiscal year start month (1 = January, 10 = October).
   * Used to convert Unanet period numbers (1-12) to calendar months.
   * Default: 1 (calendar year).
   */
  fiscalYearStart?: number;
  /** Use "Net Change" column instead of "Ending Balance" (default: false) */
  useNetChange?: boolean;
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

export function parseUnanet(
  csvContent: string,
  options: ParseOptions = {}
): TrialBalanceParseResult {
  const warnings: string[] = [];
  const transformations: string[] = [];
  const fyStart = options.fiscalYearStart ?? 1;

  try {
    const rawLines = csvContent.split('\n');

    // Locate header row
    let headerIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const lower = rawLines[i].toLowerCase();
      if (
        (lower.includes('account') || lower.includes('acct')) &&
        (lower.includes('debit') || lower.includes('credit') || lower.includes('balance') || lower.includes('amount'))
      ) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      warnings.push('Could not locate column header row. Expected "Account Number" + "Debits"/"Credits"/"Ending Balance".');
      return {
        data: [],
        warnings,
        metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'unanet' }
      };
    }

    if (headerIdx > 0) {
      const preamble = rawLines.slice(0, headerIdx).join('\n');
      const p = extractPeriodFromPreamble(preamble);
      if (p && !options.defaultPeriod) {
        options = { ...options, defaultPeriod: p };
        transformations.push(`Extracted period from report header: "${p}"`);
      }
      transformations.push(`Skipped ${headerIdx} preamble row(s)`);
    }

    const headers = parseCSVLine(rawLines[headerIdx]);
    const dataLines = rawLines.slice(headerIdx + 1).filter(l => l.trim());
    const confidence = validateUnanetFormat(headers);

    if (confidence < 0.4) {
      warnings.push(`Low confidence this is Unanet format (${Math.round(confidence * 100)}%). Found: ${headers.join(', ')}`);
    }

    const data: GLActualsRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = headerIdx + i + 2;
      const values = parseCSVLine(dataLines[i]);
      if (values.every(v => !v.trim())) continue;

      const first = (values[0] ?? '').trim().toLowerCase();
      if (isSkipRow(first, values)) {
        continue;
      }

      try {
        const parsed = parseUnanetRow(headers, values, options, fyStart, transformations);
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
        system: 'unanet',
      }
    };
  } catch (err: any) {
    warnings.push(`Parse error: ${err.message}`);
    return {
      data: [],
      warnings,
      metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'unanet' }
    };
  }
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

function parseUnanetRow(
  headers: string[],
  values: string[],
  options: ParseOptions,
  fyStart: number,
  transformations: string[]
): GLActualsRow | null {
  let account = '';
  let debit = 0;
  let credit = 0;
  let endingBalance: number | undefined;
  let netChange: number | undefined;
  let periodMonth = ''; // month name, number 1-12, or YYYY-MM
  let periodYear = '';  // separate year column
  let period = options.defaultPeriod ?? '';
  let entity = options.entityCode ?? '';

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim().replace(/\s+/g, ' ');
    const v = (values[i] ?? '').trim();

    if (h === 'account number' || h === 'account no' || h === 'acct number' || h === 'acct no' || h === 'account #') {
      account = v;
    } else if (h === 'account' || h === 'acct') {
      // Could be code or code+name depending on Unanet version; use as-is
      if (!account) account = v;
    } else if (h === 'debits' || h === 'debit' || h === 'dr') {
      debit = parseUnanetNumber(v);
    } else if (h === 'credits' || h === 'credit' || h === 'cr') {
      credit = parseUnanetNumber(v);
    } else if (h === 'ending balance' || h === 'end balance' || h === 'closing balance' || h === 'balance') {
      endingBalance = parseUnanetNumber(v);
    } else if (h === 'net change' || h === 'net activity' || h === 'activity') {
      netChange = parseUnanetNumber(v);
    } else if (h === 'period' || h === 'fiscal period' || h === 'month') {
      periodMonth = v;
    } else if (h === 'year' || h === 'fiscal year') {
      periodYear = v;
    } else if (h === 'organization' || h === 'org' || h === 'company' || h === 'cost center') {
      if (v && !entity) entity = v;
    }
  }

  // Resolve period
  if (!period) {
    period = resolvePeriod(periodMonth, periodYear, fyStart, transformations);
  }

  if (!account) throw new Error('Missing account number');

  // Calculate amount
  let amount: number;
  if (options.useNetChange && netChange !== undefined) {
    amount = netChange;
    transformations.push(`Using net change for ${account}: ${amount}`);
  } else if (debit !== 0 || credit !== 0) {
    amount = debit - credit;
    if (debit !== 0 && credit !== 0) {
      transformations.push(`Net for ${account}: Debit ${debit} - Credit ${credit} = ${amount}`);
    }
  } else if (endingBalance !== undefined) {
    amount = endingBalance;
  } else if (netChange !== undefined) {
    amount = netChange;
    transformations.push(`Using net change for ${account}: ${amount}`);
  } else {
    throw new Error(`No amount for account "${account}"`);
  }

  if (amount === 0) return null;

  const row: GLActualsRow = { period, account, amount };
  if (entity) row.entity = entity;
  return row;
}

// ---------------------------------------------------------------------------
// Period resolution
// ---------------------------------------------------------------------------

const MONTH_NAMES: Record<string, string> = {
  january: '01', jan: '01', february: '02', feb: '02',
  march: '03', mar: '03', april: '04', apr: '04',
  may: '05', june: '06', jun: '06', july: '07', jul: '07',
  august: '08', aug: '08', september: '09', sep: '09', sept: '09',
  october: '10', oct: '10', november: '11', nov: '11', december: '12', dec: '12',
};

/**
 * Resolve period from Unanet period column + optional year column.
 * fyStart: 1-12 fiscal year start month (1 = January calendar year).
 */
function resolvePeriod(month: string, year: string, fyStart: number, transformations: string[]): string {
  if (!month && !year) return '';

  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(month)) return month;

  // ISO date YYYY-MM-DD
  const isoMatch = month.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  // Month name ("October", "Oct")
  const monthName = MONTH_NAMES[month.toLowerCase()];
  if (monthName && year) {
    const period = `${year}-${monthName}`;
    transformations.push(`Resolved period: month "${month}" year "${year}" → "${period}"`);
    return period;
  }

  // Numeric month (1-12) — Unanet fiscal period number
  const monthNum = parseInt(month, 10);
  if (!isNaN(monthNum) && monthNum >= 1 && monthNum <= 12) {
    if (year) {
      // Convert fiscal period number to calendar month
      let calMonth = ((fyStart - 1 + monthNum - 1) % 12) + 1;
      // If fyStart = 10 (October), period 1 = Oct (month 10)
      // fyStart=10: period 1 → calMonth = ((10-1)+(1-1))%12+1 = 9%12+1 = 10 ✓
      //              period 3 → calMonth = ((9)+(2))%12+1 = 11%12+1 = 12 ✓
      //              period 4 → calMonth = (9+3)%12+1 = 0+1 = 1 ✓
      const fyYear = parseInt(year, 10);
      // Determine calendar year adjustment
      let calYear = fyYear;
      if (fyStart > 1 && calMonth < fyStart) {
        // Wrapped into next calendar year
        calYear = fyYear + 1;
      }
      const period = `${calYear}-${String(calMonth).padStart(2, '0')}`;
      transformations.push(`Resolved fiscal period ${monthNum} (FY start=${fyStart}) + year ${year} → "${period}"`);
      return period;
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// Helpers
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

function parseUnanetNumber(value: string): number {
  if (!value || value.trim() === '' || value.trim() === '-') return 0;
  const isNeg = value.startsWith('(') && value.endsWith(')');
  const cleaned = value.replace(/[,()$\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : num;
}

function isSkipRow(first: string, values: string[]): boolean {
  if (!first) return true;
  const skipPrefixes = ['total', 'grand total', 'subtotal', 'net income', 'net loss', '---'];
  if (skipPrefixes.some(p => first.startsWith(p))) return true;
  // Skip if all numeric cells are empty (a label-only row)
  const nonEmpty = values.filter(v => v.trim()).length;
  if (nonEmpty === 1) return true; // only label, no data
  return false;
}

function extractPeriodFromPreamble(preamble: string): string | null {
  const asOfMatch = preamble.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (asOfMatch) {
    const month = asOfMatch[1].padStart(2, '0');
    return `${asOfMatch[3]}-${month}`;
  }
  const isoMatch = preamble.match(/(\d{4})-(\d{2})-\d{2}/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  return null;
}

function validateUnanetFormat(headers: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  let score = 0;
  if (lower.some(h => h.includes('account number') || h.includes('acct number') || h.includes('account no'))) score += 0.35;
  if (lower.some(h => h === 'debits' || h === 'debit')) score += 0.2;
  if (lower.some(h => h === 'credits' || h === 'credit')) score += 0.2;
  if (lower.some(h => h.includes('ending balance') || h.includes('net change'))) score += 0.15;
  if (lower.some(h => h === 'organization' || h === 'org')) score += 0.1;
  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export default function main(args: {
  csvContent: string;
  defaultPeriod?: string;
  entityCode?: string;
  fiscalYearStart?: number;
  useNetChange?: boolean;
}) {
  const { csvContent, ...options } = args;
  const result = parseUnanet(csvContent, options);

  console.log('\nUnanet Trial Balance Parser Results\n');
  console.log(`System:             unanet`);
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
