# Indirect Rates Forecast — User Guide

This guide covers the web application at `http://localhost:3000` (or your deployed URL). For local setup see `LOCAL_SETUP.md`. For the REST API see `API_GUIDE.md`.

---

## Feature Inventory

| Feature | Where | Notes |
|---|---|---|
| Fiscal Year management | `/fiscal-years` | Create / delete FYs; auto-copy config |
| Chart of Accounts | `/chart-of-accounts` | Add GL account numbers and names |
| Pool Setup | `/pools` | Rate groups, pool groups, account shuttle, AI mapping |
| Cost Structure | `/cost-structure` | Verify cascade formulas by category |
| Mappings | `/mappings` | Align Labor/ODC/Subk category mappings |
| Scenarios | `/scenarios` | Create what-if scenarios and events |
| GL Ledger | `/data` (GL tab) | Import or enter GL actuals; triggers auto-forecast |
| Direct Costs | `/data` (DC tab) | Import or enter direct costs |
| Forecast | `/forecast` | Run forecast; view results; History with Auto badge |
| PST Report | `/pst` | Period Status Table — actuals vs forecast |
| PSR Report | `/psr` | Project Status Report |

---

## Recommended Workflow

The pages build on each other in this order:

```
1. Fiscal Years  →  2. Chart of Accounts  →  3. Pool Setup  →  4. Data (GL + DC)  →  5. Forecast
```

---

## 1. Fiscal Years (`/fiscal-years`)

A fiscal year is the container for all your pool configuration, GL data, scenarios, and forecast runs.

### Create a fiscal year

1. Click **New Fiscal Year**
2. Enter a name (e.g. `FY2025`), start month (`2024-10`), and end month (`2025-09`)
3. **If other fiscal years already exist**, a "Copy configuration from existing FY" checkbox appears — it is checked by default and pre-selects the most recently created FY as the source
   - Leave it checked to clone the source FY's pool groups, GL account mappings, and chart of accounts into the new FY automatically
   - Uncheck it to start from a blank slate
4. Click **Create**
5. A toast confirms the result, e.g.:
   > *"Created FY2025. Copied 3 pool groups + 12 mappings from FY2024."*

### Delete a fiscal year

Click the trash icon on the row. This deletes all pool config, GL data, scenarios, and forecast runs associated with that FY. **This is permanent.**

---

## 2. Chart of Accounts (`/chart-of-accounts`)

The Chart of Accounts for a fiscal year is the source list that the Pool Setup shuttle draws from. An account must exist here before it can be assigned to a pool.

### Add accounts

- **Manually**: Enter account number and name → click **Add**
- **Bulk import**: Upload a CSV with columns `Account,Name,Category`
- **From GL data**: Accounts that appear in your imported GL actuals can be auto-detected and added

### Account fields

| Field | Required | Example |
|---|---|---|
| Account | Yes | `6096.01` |
| Name | Recommended | `Allocations` |
| Category | Optional | `Overhead` |

---

## 3. Pool Setup (`/pools`)

This page is where you define the indirect rate structure and assign GL accounts to cost pools.

### Structure overview

```
Rate Group  (e.g. "Primary Rate Structure")
  └── Pool Group  (e.g. "Fringe", "Overhead", "G&A")
        ├── Sub-pools  (optional breakdown, e.g. "FICA", "Health")
        ├── Cost Accounts (Numerator)  — GL accounts whose costs go INTO the pool
        └── Base Accounts (Denominator) — GL accounts that form the allocation base
```

### Assign accounts manually (shuttle UI)

Each pool group has a two-panel shuttle:
- **Left panel (Available)** — accounts in the Chart of Accounts not yet assigned to any pool
- **Right panel (Assigned)** — accounts currently in this pool

Click an account on the left → click **›** to assign it. Click an account on the right → click **‹** to unassign it. Changes are **staged** until you click **Save**.

### AI Suggest — automated account mapping

When unmapped accounts exist in the Available list, an **"AI Suggest"** button appears in the top-right corner of the Cost Accounts panel.

**Step-by-step:**

1. Make sure the account exists in the Chart of Accounts (e.g. `6096.01 – Allocations`)
2. Navigate to **Pools** → select the fiscal year → expand the pool group you want to map into (e.g. **G&A**)
3. Confirm `6096.01` appears in the **Available** (left) panel of Cost Accounts — if it doesn't, it may already be mapped to another pool group
4. Click **AI Suggest** (sparkle icon, top-right of Available panel)
5. A dialog opens showing AI suggestions for that pool group:

   | Account | Pool / Flag | Reason | Accept? |
   |---|---|---|---|
   | 6096.01 – Allocations | G&A | indirect cost allocation | ✓ |
   | 8520 – Entertainment | Unallowable | FAR 31.205-14 | ✓ |

6. Check or uncheck each row — all are accepted by default
7. Click **Apply (N)** to stage the accepted accounts into pending changes
8. A confirmation banner appears: *"N accounts added. Review and Save."*
9. Click **Save** to persist to the database

**What the AI uses to decide:**
- The account number and name (e.g. `6096.01 – Allocations`)
- The name and base of every pool group in the FY (e.g. `G&A / TCI`, `Fringe / DL`, `Overhead / DL`)
- FAR 31.205 unallowable cost rules

**If GEMINI_API_KEY is not configured**, the button will return an error. Set `GEMINI_API_KEY` in `web/.env.local` to enable it.

### Copy from another FY

Already have a pool structure from last year? On the Pools page click **Copy from FY** (top-right of the Rate Structure section) → select the source FY → click **Copy Setup**. This clones chart accounts, rate groups, pool groups, pools, GL mappings, and base accounts. You can also trigger this automatically at FY creation time (see Section 1).

### Cascade order

Pool groups cascade when computing rates — Fringe is computed first (cascade order 0), its dollar amount is included in the Overhead base, and both are included in the G&A base. Set cascade order in each pool group's Edit dialog. Lower = computed earlier.

---

## 4. Data — GL Actuals (`/data`)

### Import GL actuals via CSV

1. Go to **Data** → **GL Ledger** tab
2. Click **Import CSV**
3. Upload a file with columns: `Period,Account,Amount` (optional: `Entity`)
4. Rows with parse errors are reported; valid rows are inserted
5. A background forecast run is automatically queued (see Section 5)

### CSV format

```
Period,Account,Amount,Entity
2024-10,6000,125000.00,DIV-A
2024-10,6096.01,8500.00,DIV-A
2024-11,6000,127500.00,DIV-A
```

- `Period`: YYYY-MM format
- `Account`: must match an account in your pool mappings (accounts not in any pool are ignored by the forecast engine)
- `Amount`: positive = cost, negative = credit/reversal

### Manual entry

Use the **+ Add Entry** row at the bottom of the GL table for one-off adjustments.

---

## 5. Forecast (`/forecast`)

### Run a forecast manually

1. Select a **Fiscal Year** (DB mode)
2. Choose a **Scenario** (default: Base)
3. Set **Forecast months** and **Run-rate months**
4. Click **Run Forecast**
5. Results display in the tabs: Rates, Pool Costs, Base Costs, Projections
6. The run is saved to History automatically

### Auto-forecast (background)

The forecast re-runs automatically in the background whenever data changes:

| Action | Triggers auto-forecast |
|---|---|
| Import GL entries (CSV) | Yes |
| Clear all GL entries | Yes |
| Upload a file (GL/DC/etc.) | Yes |
| Create a scenario | Yes |
| Edit a scenario | Yes |
| Delete a scenario | Yes |

After any of these actions, check the **History** tab — a new run will appear within ~30 seconds.

### History table

| Column | Meaning |
|---|---|
| Date | When the run completed |
| Scenario | Which scenario was used |
| Origin | **Auto** (background trigger) or **Manual** (you clicked Run) |
| Months | Forecast horizon |
| Run-rate | Run-rate averaging window |
| Size | Output ZIP size |

- **Load** — restores the run's results into the view above
- **Download** — saves the output ZIP (Excel + charts + narrative) to disk
- **Delete** — permanently removes the run

---

## 6. Scenarios (`/scenarios`)

Scenarios let you model what-if changes on top of actuals.

### Create a scenario

1. Click **New Scenario** → name it (e.g. `10% Headcount Reduction`)
2. Add **events** — each event specifies an effective period and deltas to direct labor, subcontracts, ODC, travel, or pool costs
3. Select the scenario name when running a forecast

Creating, editing, or deleting a scenario triggers an automatic background forecast (see Section 5).

---

## 7. PST Report (`/pst`)

The Period Status Table shows actuals vs. forecast side by side for a selected period. Select a fiscal year, a reporting period, and optionally a scenario. The table updates automatically.

---

## Tips & Troubleshooting

### Account not appearing in the Pool shuttle

- Verify the account exists in **Chart of Accounts** for the selected FY
- Check it isn't already assigned to a different pool group (each account can only be in one pool's numerator)
- Make sure the correct FY is selected in the Pools page dropdown

### AI Suggest shows no suggestions for my pool group

Gemini matched all unmapped accounts to other pool groups. Try expanding a different pool group and running AI Suggest there — the suggestions are per-pool-group. You can also assign the account manually using the shuttle.

### Forecast History shows no auto runs

- Check the Python backend is running (`indirectrates serve`)
- Background tasks run in-process; if the server restarted mid-run the task is lost — just re-import or trigger a manual run
- Auto-forecast only fires for **DB mode** (when a fiscal year is selected); file-upload-only mode does not auto-forecast

### "Missing GEMINI_API_KEY" error on AI Suggest

Add `GEMINI_API_KEY=your-key` to `web/.env.local` and restart `npm run dev`.

### Copy from FY doesn't copy GL actuals or direct costs

By design — only pool configuration is copied (chart accounts, rate groups, pool groups, pools, GL mappings, base accounts). GL data and scenarios are FY-specific.
