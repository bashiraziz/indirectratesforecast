/**
 * Oracle NetSuite Trial Balance CSV Parser Skill
 *
 * Parses NetSuite GL and trial balance exports, converting them to canonical GL_Actuals format.
 *
 * NetSuite Format Characteristics:
 * - Flexible account code formats:
 *   "6000 Salaries Expense" → "6000"
 *   "AP-2000" → "2000"
 *   "Accounts Payable (2000)" → "2000"
 *   "6000" → "6000"
 * - Multi-currency: prioritizes "Amount (Base Currency)" over transaction currency
 * - Dimensional rows: Department, Location, Subsidiary, Class may each get their own row
 *   → aggregated by account+period+subsidiary for clean output
 * - Subsidiary column → entity field
 * - Standard US date format MM/DD/YYYY or ISO YYYY-MM-DD
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
    dimensionalRowsAggregated: number;
  };
}

export interface ParseOptions {
  defaultPeriod?: string;
  entityCode?: string;
  /** Aggregate dimensional rows by account+period+entity (default: true) */
  aggregateDimensions?: boolean;
  /** Map Subsidiary column to entity (default: true) */
  subsidiaryAsEntity?: boolean;
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

export function parseNetSuite(
  csvContent: string,
  options: ParseOptions = {}
): TrialBalanceParseResult {
  const warnings: string[] = [];
  const transformations: string[] = [];
  const aggregate = options.aggregateDimensions !== false; // default true
  const useSubsidiary = options.subsidiaryAsEntity !== false; // default true

  try {
    const rawLines = csvContent.split('\n');

    // Locate header row
    let headerIdx = -1;
    for (let i = 0; i < rawLines.length; i++) {
      const lower = rawLines[i].toLowerCase();
      if (
        lower.includes('account') &&
        (lower.includes('amount') || lower.includes('debit') || lower.includes('credit') || lower.includes('balance'))
      ) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      warnings.push('Could not locate column header row. Expected "Account" + "Amount"/"Debit"/"Credit" columns.');
      return {
        data: [],
        warnings,
        metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'netsuite', dimensionalRowsAggregated: 0 }
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
    const confidence = validateNetSuiteFormat(headers);

    if (confidence < 0.4) {
      warnings.push(`Low confidence this is NetSuite format (${Math.round(confidence * 100)}%). Found: ${headers.join(', ')}`);
    }

    // Identify the best amount column index (prefer base currency)
    const baseCurrencyIdx = findBaseCurrencyColumn(headers);
    if (baseCurrencyIdx !== -1) {
      transformations.push(`Using "Amount (Base Currency)" column (index ${baseCurrencyIdx}) for multi-currency normalization`);
    }

    // Raw parsed rows before aggregation
    const rawRows: GLActualsRow[] = [];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = headerIdx + i + 2;
      const values = parseCSVLine(dataLines[i]);
      if (values.every(v => !v.trim())) continue;

      if (isSkipRow(values)) {
        transformations.push(`Skipped total/label row: "${values[0]?.trim()}"`);
        continue;
      }

      try {
        const parsed = parseNSRow(headers, values, options, useSubsidiary, baseCurrencyIdx, transformations);
        if (parsed) rawRows.push(parsed);
      } catch (err: any) {
        warnings.push(`Row ${rowNum}: ${err.message}`);
      }
    }

    // Aggregate dimensional rows
    let data: GLActualsRow[];
    let dimensionalRowsAggregated = 0;

    if (aggregate && rawRows.length > 0) {
      const { aggregated, collapsed } = aggregateByAccountPeriodEntity(rawRows);
      data = aggregated;
      dimensionalRowsAggregated = collapsed;
      if (collapsed > 0) {
        transformations.push(`Aggregated ${rawRows.length} dimensional rows → ${aggregated.length} account rows (${collapsed} collapsed)`);
      }
    } else {
      data = rawRows;
    }

    const missingPeriod = data.filter(r => !r.period).length;
    if (missingPeriod > 0) {
      warnings.push(`${missingPeriod} row(s) have no period. Pass defaultPeriod or ensure a Period/Date column exists.`);
    }

    return {
      data: data.filter(r => r.period),
      warnings,
      metadata: {
        rowsExtracted: rawRows.length,
        formatConfidence: confidence,
        transformationsApplied: transformations,
        system: 'netsuite',
        dimensionalRowsAggregated,
      }
    };
  } catch (err: any) {
    warnings.push(`Parse error: ${err.message}`);
    return {
      data: [],
      warnings,
      metadata: { rowsExtracted: 0, formatConfidence: 0, transformationsApplied: [], system: 'netsuite', dimensionalRowsAggregated: 0 }
    };
  }
}

// ---------------------------------------------------------------------------
// Row parser
// ---------------------------------------------------------------------------

function parseNSRow(
  headers: string[],
  values: string[],
  options: ParseOptions,
  useSubsidiary: boolean,
  baseCurrencyIdx: number,
  transformations: string[]
): GLActualsRow | null {
  let account = '';
  let debit = 0;
  let credit = 0;
  let amount: number | undefined;
  let period = options.defaultPeriod ?? '';
  let entity = options.entityCode ?? '';

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();
    const v = (values[i] ?? '').trim();

    // Account
    if (h === 'account' || h === 'account name' || h === 'gl account') {
      const extracted = extractNSAccountCode(v);
      account = extracted.code;
      if (extracted.code !== v) {
        transformations.push(`Extracted account "${extracted.code}" from "${v}"`);
      }
    }
    // Amount — prefer base currency column
    else if (i === baseCurrencyIdx) {
      amount = parseNSNumber(v);
    } else if (amount === undefined && (h === 'amount' || h === 'net amount' || h === 'balance')) {
      amount = parseNSNumber(v);
    }
    // Debit/Credit
    else if (h === 'debit' || h === 'dr') {
      debit = parseNSNumber(v);
    } else if (h === 'credit' || h === 'cr') {
      credit = parseNSNumber(v);
    }
    // Period / Date
    else if (h === 'period' || h === 'posting period' || h === 'fiscal period') {
      const p = parseNSPeriod(v);
      if (p) { period = p; if (v !== p) transformations.push(`Period "${v}" → "${p}"`); }
    } else if (h === 'date' || h === 'transaction date') {
      const p = parseNSPeriod(v);
      if (p && !period) { period = p; }
    }
    // Subsidiary → entity
    else if (useSubsidiary && (h === 'subsidiary' || h === 'legal entity')) {
      if (v && !entity) entity = v;
    }
  }

  if (!account) throw new Error('Missing account');

  let finalAmount: number;
  if (amount !== undefined) {
    finalAmount = amount;
  } else if (debit !== 0 || credit !== 0) {
    finalAmount = debit - credit;
    if (debit !== 0 && credit !== 0) {
      transformations.push(`Net for ${account}: ${debit} - ${credit} = ${finalAmount}`);
    }
  } else {
    throw new Error(`No amount for account "${account}"`);
  }

  if (finalAmount === 0) return null;

  const row: GLActualsRow = { period, account, amount: finalAmount };
  if (entity) row.entity = entity;
  return row;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function aggregateByAccountPeriodEntity(
  rows: GLActualsRow[]
): { aggregated: GLActualsRow[]; collapsed: number } {
  const map = new Map<string, GLActualsRow>();
  let collapsed = 0;

  for (const row of rows) {
    const key = `${row.account}|${row.period}|${row.entity ?? ''}`;
    const existing = map.get(key);
    if (existing) {
      existing.amount += row.amount;
      collapsed++;
    } else {
      map.set(key, { ...row });
    }
  }

  return {
    aggregated: Array.from(map.values()).filter(r => r.amount !== 0),
    collapsed,
  };
}

// ---------------------------------------------------------------------------
// Account code extraction
// ---------------------------------------------------------------------------

/**
 * Extract account code from various NetSuite formats:
 * "6000 Salaries Expense"     → "6000"
 * "AP-2000"                   → "2000"
 * "Accounts Payable (2000)"   → "2000"
 * "6000"                      → "6000"
 */
function extractNSAccountCode(value: string): { code: string; name: string | null } {
  // "6000 Account Name" — leading numeric code
  const leadingNum = value.match(/^(\d[\d.]*)\s+(.+)$/);
  if (leadingNum) return { code: leadingNum[1], name: leadingNum[2].trim() };

  // "Account Name (2000)" — parenthetical trailing code
  const parenthetical = value.match(/^(.+?)\s*\((\d[\d.]*)\)$/);
  if (parenthetical) return { code: parenthetical[2], name: parenthetical[1].trim() };

  // "PREFIX-2000" — dash-separated prefix
  const dashed = value.match(/^[A-Z]+-(\d[\d.]*)$/i);
  if (dashed) return { code: dashed[1], name: null };

  // Plain code
  return { code: value.trim(), name: null };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findBaseCurrencyColumn(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    if (headers[i].toLowerCase().includes('base currency')) return i;
  }
  return -1;
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

function parseNSNumber(value: string): number {
  if (!value || value.trim() === '') return 0;
  const isNeg = value.startsWith('(') && value.endsWith(')');
  const cleaned = value.replace(/[,()$\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNeg ? -Math.abs(num) : num;
}

function parseNSPeriod(value: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}$/.test(value)) return value;
  const isoMatch = value.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  // MM/DD/YYYY
  const mdyMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}`;
  // MM/YYYY (NetSuite posting period common format)
  const mmYYYY = value.match(/^(\d{1,2})\/(\d{4})$/);
  if (mmYYYY) return `${mmYYYY[2]}-${mmYYYY[1].padStart(2, '0')}`;
  return null;
}

function isSkipRow(values: string[]): boolean {
  const first = (values[0] ?? '').trim().toLowerCase();
  if (!first) return true;
  const totalPrefixes = ['total', 'grand total', 'subtotal', 'net income', 'net loss'];
  return totalPrefixes.some(p => first.startsWith(p));
}

function extractPeriodFromPreamble(preamble: string): string | null {
  const mdyMatch = preamble.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (mdyMatch) return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}`;
  const isoMatch = preamble.match(/(\d{4})-(\d{2})-\d{2}/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}`;
  return null;
}

function validateNetSuiteFormat(headers: string[]): number {
  const lower = headers.map(h => h.toLowerCase().trim());
  let score = 0;
  if (lower.some(h => h.includes('base currency'))) score += 0.4;
  if (lower.some(h => h === 'subsidiary' || h === 'legal entity')) score += 0.2;
  if (lower.some(h => h === 'posting period' || h === 'fiscal period')) score += 0.2;
  if (lower.some(h => h === 'account' || h === 'account name')) score += 0.1;
  if (lower.some(h => h === 'department' || h === 'location' || h === 'class')) score += 0.1;
  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

export default function main(args: {
  csvContent: string;
  defaultPeriod?: string;
  entityCode?: string;
  aggregateDimensions?: boolean;
  subsidiaryAsEntity?: boolean;
}) {
  const { csvContent, ...options } = args;
  const result = parseNetSuite(csvContent, options);

  console.log('\nOracle NetSuite Trial Balance Parser Results\n');
  console.log(`System:                      netsuite`);
  console.log(`Rows extracted:              ${result.metadata.rowsExtracted}`);
  console.log(`Dimensional rows aggregated: ${result.metadata.dimensionalRowsAggregated}`);
  console.log(`Format confidence:           ${Math.round(result.metadata.formatConfidence * 100)}%`);

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
