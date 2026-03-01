/**
 * Deltek Vision / Vantagepoint Trial Balance CSV Parser Skill
 *
 * Parses Deltek Vision and Vantagepoint GL summary and trial balance exports,
 * converting them to the canonical GL_Actuals format.
 *
 * Vision / Vantagepoint Format Characteristics:
 * - Separate "Debit Amount" / "Credit Amount" columns (net = Debit - Credit)
 *   OR a single "Balance" / "Net" column
 * - Account in "Account" or "Account Number" or "GL Account" column
 * - Period may be "MM/YYYY" (e.g. "10/2024"), "MM/DD/YYYY", or "YYYY-MM"
 * - Company / Organization column → entity
 * - Comma-formatted numbers; parentheses indicate negative
 * - Total/subtotal rows automatically skipped
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
  defaultPeriod?: string;
  entityCode?: string;
  /** Use the "Balance" column directly rather than Debit - Credit (default: false) */
  useBalance?: boolean;
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

export function parseVision(
  csvContent: string,
  options: ParseOptions = {}
): TrialBalanceParseResult {
  const warnings: string[] = [];
  const transformations: string[] = [];

  try {
    const rawLines = csvContent.split('\n');

    // Locate header row
    let headerIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const lower = rawLines[i].toLowerCase();
      if (
        (lower.includes('account') || lower.includes('gl account')) &&
        (lower.includes('debit') || lower.includes('credit') || lower.includes('balance') || lower.includes('amount'))
      ) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      warnings.push('Could not locate column header row. Expected an "Account" column alongside Debit/Credit/Balance.');
      return {
        data: [],
        warnings,
        metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'vision' }
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
    const confidence = validateVisionFormat(headers);

    if (confidence < 0.4) {
      warnings.push(`Low confidence this is Deltek Vision format (${Math.round(confidence * 100)}%). Found: ${headers.join(', ')}`);
    }

    const data: GLActualsRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = headerIdx + i + 2;
      const values = parseCSVLine(dataLines[i]);
      if (values.every(v => !v.trim())) continue;

      if (isSkipRow(values)) {
        transformations.push(`Skipped total/label row: "${values[0]?.trim()}"`);
        continue;
      }

      try {
        const parsed = parseVisionRow(headers, values, options, transformations);
        if (parsed) data.push(parsed);
      } catch (err: any) {
        warnings.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    const missingPeriod = data.filter(r => !r.period).length;
    if (missingPeriod > 0) {
      warnings.push(`${missingPeriod} row(s) have no period. Add a Period/Month column or pass defaultPeriod.`);
    }

    return {
      data: data.filter(r => r.period),
      warnings,
      metadata: {
        rowsExtracted: data.length,
        formatConfidence: confidence,
        transformationsApplied: transformations,
        system: 'vision',
      }
    };
  } catch (err: any) {
    warnings.push(`Parse error: ${err.message}`);
    return {
      data: [],
      warnings,
      metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'vision' }
    };
  }
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

function parseVisionRow(
  headers: string[],
  values: string[],
  options: ParseOptions,
  transformations: string[]
): GLActualsRow | null {
  let account = '';
  let debit = 0;
  let credit = 0;
  let balance: number | undefined;
  let period = options.defaultPeriod ?? '';
  let entity = options.entityCode ?? '';

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim().replace(/\s+/g, ' ');
    const v = (values[i] ?? '').trim();

    // Account columns
    if (h === 'account number' || h === 'account no' || h === 'gl account' || h === 'acct no') {
      account = v;
    } else if ((h === 'account' || h === 'acct') && !account) {
      account = v;
    }
    // Debit columns — Vision uses various names
    else if (h === 'debit amount' || h === 'debit' || h === 'dr amount' || h === 'dr') {
      debit = parseVisionNumber(v);
    }
    // Credit columns
    else if (h === 'credit amount' || h === 'credit' || h === 'cr amount' || h === 'cr') {
      credit = parseVisionNumber(v);
    }
    // Balance / Net column
    else if (h === 'balance' || h === 'ending balance' || h === 'net' || h === 'net change' || h === 'net amount') {
      balance = parseVisionNumber(v);
    }
    // Period / Date
    else if (h === 'period' || h === 'month' || h === 'fiscal period' || h === 'date') {
      const p = parseVisionPeriod(v);
      if (p) {
        period = p;
        if (v !== p) transformations.push(`Converted period "${v}" → "${p}"`);
      }
    }
    // Entity
    else if (h === 'company' || h === 'org' || h === 'organization' || h === 'division' || h === 'entity') {
      if (v && !entity) entity = v;
    }
  }

  if (!account) throw new Error('Missing account code');

  let amount: number;
  if (options.useBalance && balance !== undefined) {
    amount = balance;
    transformations.push(`Using balance column for ${account}: ${amount}`);
  } else if (debit !== 0 || credit !== 0) {
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

function parseVisionNumber(value: string): number {
  if (!value || value.trim() === '') return 0;
  const isNeg = value.startsWith('(') && value.endsWith(')');
  const cleaned = value.replace(/[,()$\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : num;
}

/**
 * Parse Vision period formats:
 * "10/2024" (MM/YYYY) → "2024-10"
 * "10/31/2024" (MM/DD/YYYY) → "2024-10"
 * "2024-10-31" (ISO) → "2024-10"
 * "2024-10" (already) → "2024-10"
 */
function parseVisionPeriod(value: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value;

  // ISO YYYY-MM-DD
  const isoMatch = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;

  // MM/YYYY (Vision common)
  const mmYYYY = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1].padStart(2, '0')}`;

  // MM/DD/YYYY
  const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}`;

  return null;
}

function isSkipRow(values: string[]): boolean {
  const first = (values[0] ?? '').trim().toLowerCase();
  if (!first) return true;
  const totalPrefixes = ['total', 'grand total', 'subtotal', 'net income', 'net loss'];
  if (totalPrefixes.some(p => first.startsWith(p))) return true;
  // A row where the only non-empty value is in the first column is likely a section header
  const nonEmpty = values.filter(v => v.trim()).length;
  if (nonEmpty === 1 && !(/\d/.test(first))) return true;
  return false;
}

function extractPeriodFromPreamble(preamble: string): string | null {
  // MM/DD/YYYY
  const mdyMatch = preamble.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}`;
  // ISO
  const isoMatch = preamble.match(/(\d{4})-(\d{2})-\d{2}/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  return null;
}

function validateVisionFormat(headers: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  let score = 0;
  if (lower.some(h => h === 'debit amount' || h === 'dr amount')) score += 0.3;
  if (lower.some(h => h === 'credit amount' || h === 'cr amount')) score += 0.3;
  if (lower.some(h => h.includes('account number') || h === 'gl account')) score += 0.2;
  if (lower.some(h => h === 'company' || h === 'organization')) score += 0.1;
  if (lower.some(h => h === 'period' || h === 'month' || h === 'fiscal period')) score += 0.1;
  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export default function main(args: {
  csvContent: string;
  defaultPeriod?: string;
  entityCode?: string;
  useBalance?: boolean;
}) {
  const { csvContent, ...options } = args;
  const result = parseVision(csvContent, options);

  console.log('\nDeltek Vision / Vantagepoint Trial Balance Parser Results\n');
  console.log(`System:             vision`);
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
