# Trial Balance Parser Skills

These Claude Code skills parse trial balance exports from major accounting systems into the canonical `GL_Actuals.csv` format used by the Indirect Rates Forecast application.

## Canonical Output Format

All parsers produce `GLActualsRow[]` which maps directly to the app's GL import format:

```csv
Period,Account,Amount,Entity
2024-10,6000,125000.00,DIV-A
2024-10,6096.01,8500.00,DIV-A
2024-11,6000,127500.00,DIV-A
```

| Field | Type | Description |
|---|---|---|
| `Period` | `YYYY-MM` | Fiscal period, e.g. `2024-10` |
| `Account` | string | GL account code as exported from your system |
| `Amount` | number | Positive = cost/debit, Negative = credit/reversal |
| `Entity` | string (optional) | Division, org, subsidiary code |

## Available Skills

| Skill | System | Key Characteristics |
|---|---|---|
| `xero-parser` | Xero | YTD Debit/Credit columns; ISO or DD/MM/YYYY dates; code+name format |
| `quickbooks-parser` | QuickBooks Desktop / Online | Parenthetical codes `"Accounts Payable (2000)"`; US dates; comma numbers |
| `unanet-parser` | Unanet / Deltek | Ending balance or Debits+Credits; Org column; month-number periods |
| `costpoint-parser` | Deltek Costpoint | Separate Debit/Credit columns; credits shown positive; org → entity |
| `vision-parser` | Deltek Vision / Vantagepoint | Separate Debit/Credit columns; Company/Org → entity; US dates |
| `netsuite-parser` | Oracle NetSuite | Flexible account formats; multi-dimension; base currency prioritized |
| `generic-parser` | Any / Unknown | Auto-detects format, date, sign convention, and entity column |

## Usage Pattern

Each skill exposes:
- `parse<System>(csvContent, options?)` — main parse function
- `toGLActualsCSV(data)` — converts parsed rows to importable CSV string
- `main(args)` — CLI-friendly entry point

```typescript
import { parseXero, toGLActualsCSV } from './xero-parser/parse';

const result = parseXero(csvContent, { defaultPeriod: '2024-10' });

if (result.warnings.length > 0) {
  console.warn(result.warnings);
}

const csv = toGLActualsCSV(result.data);
// → paste into /data GL Import, or save as GL_Actuals.csv
```

## Sign Convention Reference

The app uses **cost-positive** convention: expense account debits are positive.

| Account Type | Normal Balance | Expected Amount Sign |
|---|---|---|
| Expense / Cost (5xxx–9xxx) | Debit | **Positive** |
| Revenue (4xxx) | Credit | Negative (or excluded) |
| Asset (1xxx) | Debit | Positive |
| Liability (2xxx) | Credit | Negative |
| Equity (3xxx) | Credit | Negative |

## Selecting the Right Parser

1. **Known system** → use that system's parser for highest accuracy
2. **Unknown or mixed** → use `generic-parser` which auto-detects
3. **Low confidence warning** → switch parsers or use `generic-parser`

## Adding a New System

Copy any existing skill directory, rename it, and update:
- `skill.json` — capabilities and system specifics
- `parse.ts` — implement `validateFormat()`, `parseRow()`, and any sign-convention logic

Follow the existing pattern:
1. Parse CSV lines (handle quoted commas)
2. Map headers to canonical fields
3. Apply sign convention
4. Log all transformations to `metadata.transformationsApplied`
5. Emit warnings for low-confidence rows, not errors
