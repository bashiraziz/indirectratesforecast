/**
 * Deltek Costpoint Trial Balance CSV Parser Skill
 *
 * Parses Costpoint GL Inquiry and Trial Balance exports, converting them
 * to the canonical GL_Actuals format.
 *
 * Costpoint Format Characteristics:
 * - Separate Debit and Credit columns (NOT a combined balance)
 * - CRITICAL: Costpoint displays credit entries as POSITIVE values
 *   → Net = Debit - Credit gives correct accounting result:
 *     Expense account: Debit 85000 - Credit 0 = +85000 (positive, correct)
 *     Liability account: Debit 0 - Credit 52850 = -52850 (negative, correct)
 * - Account code in "Account Number" or "Account" column — plain numeric or dotted
 * - Fiscal Year + Accounting_Period (1–12) in separate columns → combined to YYYY-MM
 * - Organization / Org column → entity field
 * - Numbers: plain format, commas optional
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
  /** YYYY-MM to use when no period column is found */
  defaultPeriod?: string;
  /** Entity code override for all rows */
  entityCode?: string;
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

export function parseCostpoint(
  csvContent: string,
  options: ParseOptions = {}
): TrialBalanceParseResult {
  const warnings: string[] = [];
  const transformations: string[] = [];

  try {
    const rawLines = csvContent.split('\n');

    // Find header row
    let headerIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const lower = rawLines[i].toLowerCase();
      if (
        (lower.includes('account') || lower.includes('acct')) &&
        (lower.includes('debit') || lower.includes('credit'))
      ) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      warnings.push('Could not locate column header row. Expected "Account Number" + "Debit" + "Credit" columns.');
      return {
        data: [],
        warnings,
        metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'costpoint' }
      };
    }

    if (headerIdx > 0) {
      transformations.push(`Skipped ${headerIdx} preamble row(s)`);
    }

    const headers = parseCSVLine(rawLines[headerIdx]);
    const dataLines = rawLines.slice(headerIdx + 1).filter(l => l.trim());
    const confidence = validateCostpointFormat(headers);

    if (confidence < 0.5) {
      warnings.push(`Low confidence this is Costpoint format (${Math.round(confidence * 100)}%). Expected separate Debit/Credit columns with Fiscal_Year/Accounting_Period.`);
      warnings.push(`Found: ${headers.join(', ')}`);
    }

    const data: GLActualsRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = headerIdx + i + 2;
      const values = parseCSVLine(dataLines[i]);
      if (values.every(v => !v.trim())) continue;

      // Skip total and label rows
      if (isSkipRow(values)) {
        transformations.push(`Skipped total/label row: "${values[0]?.trim()}"`);
        continue;
      }

      try {
        const parsed = parseCostpointRow(headers, values, options, transformations);
        if (parsed) data.push(parsed);
      } catch (err: any) {
        warnings.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    const missingPeriod = data.filter(r => !r.period).length;
    if (missingPeriod > 0) {
      warnings.push(`${missingPeriod} row(s) have no period. Ensure Fiscal_Year and Accounting_Period columns are present, or pass defaultPeriod.`);
    }

    return {
      data: data.filter(r => r.period),
      warnings,
      metadata: {
        rowsExtracted: data.length,
        formatConfidence: confidence,
        transformationsApplied: transformations,
        system: 'costpoint',
      }
    };
  } catch (err: any) {
    warnings.push(`Parse error: ${err.message}`);
    return {
      data: [],
      warnings,
      metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'costpoint' }
    };
  }
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

function parseCostpointRow(
  headers: string[],
  values: string[],
  options: ParseOptions,
  transformations: string[]
): GLActualsRow | null {
  let account = '';
  let debit = 0;
  let credit = 0;
  let netAmount: number | undefined;   // some reports have a pre-computed net
  let fiscalYear = '';
  let periodNum = '';
  let period = options.defaultPeriod ?? '';
  let entity = options.entityCode ?? '';

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim().replace(/\s+/g, '_');
    const v = (values[i] ?? '').trim();

    // Account identification
    if (h === 'account_number' || h === 'account_no' || h === 'acct_number' || h === 'account_#') {
      account = v;
    } else if (h === 'account' && !account) {
      account = v;
    }
    // Debit column
    else if (h === 'debit' || h === 'dr' || h === 'debit_amount') {
      debit = parseCPNumber(v);
    }
    // Credit column — Costpoint shows credits as POSITIVE
    else if (h === 'credit' || h === 'cr' || h === 'credit_amount') {
      credit = parseCPNumber(v);
    }
    // Pre-computed net (some exports have this)
    else if (h === 'net_amount' || h === 'net' || h === 'balance') {
      netAmount = parseCPNumber(v);
    }
    // Fiscal year column (e.g. "2024")
    else if (h === 'fiscal_year' || h === 'year' || h === 'fy') {
      fiscalYear = v;
    }
    // Period/month number (1-12 or 01-12)
    else if (
      h === 'accounting_period' || h === 'fiscal_period' || h === 'period' ||
      h === 'acct_period' || h === 'prd'
    ) {
      // If it looks like a full YYYY-MM, use it directly
      if (/^\d{4}-\d{2}$/.test(v)) {
        period = v;
      } else {
        periodNum = v;
      }
    }
    // Organization → entity
    else if (h === 'org' || h === 'organization' || h === 'company' || h === 'division') {
      if (v && !entity) entity = v;
    }
  }

  // Build period from fiscal year + period number
  if (!period && fiscalYear && periodNum) {
    const month = String(parseInt(periodNum, 10)).padStart(2, '0');
    period = `${fiscalYear}-${month}`;
    transformations.push(`Combined Fiscal_Year "${fiscalYear}" + Period "${periodNum}" → "${period}"`);
  }

  if (!account) throw new Error('Missing account number');

  // Calculate net amount
  // Costpoint credits shown as positive → Debit - Credit = correct net
  let amount: number;
  if (debit !== 0 || credit !== 0) {
    amount = debit - credit;
    if (debit !== 0 && credit !== 0) {
      transformations.push(`Net for ${account}: Debit ${debit} - Credit ${credit} = ${amount}`);
    } else if (credit !== 0) {
      transformations.push(`Credit balance for ${account}: 0 - ${credit} = ${amount}`);
    }
  } else if (netAmount !== undefined) {
    amount = netAmount;
  } else {
    throw new Error(`No debit/credit/net amount for account "${account}"`);
  }

  if (amount === 0) return null;

  const row: GLActualsRow = { period, account, amount };
  if (entity) row.entity = entity;
  return row;
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

function parseCPNumber(value: string): number {
  if (!value || value.trim() === '') return 0;
  const cleaned = value.replace(/[,\s$]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function isSkipRow(values: string[]): boolean {
  const first = (values[0] ?? '').trim().toLowerCase();
  if (!first) return true;
  const totalPrefixes = ['total', 'grand total', 'subtotal', 'net income', 'net loss', '---'];
  if (totalPrefixes.some(p => first.startsWith(p))) return true;
  // Skip if account column is not a valid account code (no digits)
  if (!/\d/.test(values[0] ?? '')) return true;
  return false;
}

function validateCostpointFormat(headers: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim().replace(/\s+/g, '_'));
  let score = 0;

  const hasDebit = lower.some(h => h === 'debit' || h === 'dr' || h === 'debit_amount');
  const hasCredit = lower.some(h => h === 'credit' || h === 'cr' || h === 'credit_amount');
  if (hasDebit && hasCredit) score += 0.5; // strong indicator

  if (lower.some(h => h.includes('account_number') || h.includes('acct_number'))) score += 0.2;
  if (lower.some(h => h === 'fiscal_year' || h === 'fy')) score += 0.1;
  if (lower.some(h => h === 'accounting_period' || h === 'fiscal_period' || h === 'prd')) score += 0.1;
  if (lower.some(h => h === 'org' || h === 'organization')) score += 0.1;

  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export default function main(args: {
  csvContent: string;
  defaultPeriod?: string;
  entityCode?: string;
}) {
  const { csvContent, ...options } = args;
  const result = parseCostpoint(csvContent, options);

  console.log('\nCostpoint Trial Balance Parser Results\n');
  console.log(`System:             costpoint`);
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
