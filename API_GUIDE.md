# Indirect Rates API Guide

Everything you need to call the API directly — from a script, Postman, curl, or Swagger UI —
for both local development and the production Vercel deployment.

---

## Environments

| | Local Dev | Production |
|---|---|---|
| **Frontend** | `http://localhost:3000` | `https://your-app.vercel.app` |
| **API Backend** | `http://127.0.0.1:8000` | `https://your-backend.railway.app` |
| **Swagger docs** | `http://127.0.0.1:8000/docs` | `https://your-backend.railway.app/docs` |
| **Auth** | Better Auth on localhost | Better Auth on Vercel |

> Replace `your-app.vercel.app` and `your-backend.railway.app` with your actual deployment URLs.
> The frontend URL is your Vercel app; the backend URL is wherever the Python server is hosted
> (Railway, Render, Fly.io, etc.).

---

## Authentication

The API supports two auth methods.

### Method 1 — Bearer Token (Swagger / scripts / external integrations)

Works in both local and production. Set two env vars on the **backend** server, then send the token as an `Authorization` header.

**Step 1 — Generate a token**

```bash
openssl rand -hex 32
# → e.g. a3f8c2d1e4b79f6c...
```

**Step 2 — Set env vars on the backend**

*Local (`.env` file in repo root):*
```
API_KEY=a3f8c2d1e4b79f6c...
API_KEY_USER_ID=<your-user-uuid>
```

*Production (Railway / Render / Fly.io dashboard):*
Add `API_KEY` and `API_KEY_USER_ID` as environment variables in your backend service settings.

**Step 3 — Use the token**

*Swagger UI:* open `/docs` on your backend → click the **Authorize** lock (top right) → paste token → Authorize.

*curl:*
```bash
export API_BASE="https://your-backend.railway.app"
export API_KEY="a3f8c2d1e4b79f6c..."

curl -H "Authorization: Bearer $API_KEY" $API_BASE/api/fiscal-years
```

*Python:*
```python
import os, requests

API_BASE = "https://your-backend.railway.app"   # or http://127.0.0.1:8000 for local
API_KEY  = "a3f8c2d1e4b79f6c..."
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}

r = requests.get(f"{API_BASE}/api/fiscal-years", headers=HEADERS)
print(r.json())
```

---

### Method 2 — Session Cookie via Next.js Proxy (browser / frontend calls)

When the browser on `your-app.vercel.app` calls `/api/*`, Next.js middleware intercepts it,
reads the Better Auth session cookie, and injects `X-User-ID: <uuid>` before forwarding
the request to the backend. You don't need to manage tokens — the browser session handles it.

If you need to replicate this manually (e.g. from a script calling the Vercel frontend directly):

```bash
# 1. Sign in and capture the session cookie
curl -c cookies.txt -X POST https://your-app.vercel.app/api/auth/sign-in/email \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'

# 2. Use the cookie jar for subsequent requests (routed through Next.js)
curl -b cookies.txt https://your-app.vercel.app/api/fiscal-years
```

> Note: calls to `your-app.vercel.app/api/*` route through the Next.js proxy to the backend.
> Calls to `your-backend.railway.app/api/*` go directly and require the Bearer token.

---

## Finding Your User ID

`API_KEY_USER_ID` must match your Better Auth user UUID so data lands in your account.

### Option A — From the browser (easiest)

1. Sign in at your Vercel app URL
2. Open DevTools → Network tab
3. Find any request to `/api/fiscal-years` or similar
4. Look at **Request Headers**: `X-User-ID: <your-uuid>`

### Option B — From the Better Auth session endpoint

```bash
# Grab your session cookie from DevTools:
# Application → Cookies → look for "better-auth.session_token"

curl "https://your-app.vercel.app/api/auth/get-session" \
  -H "Cookie: better-auth.session_token=<paste-value>"
```

Response:
```json
{
  "user": {
    "id": "abc123-def456-...",
    "email": "you@example.com"
  }
}
```

The `user.id` value is your UUID.

### Option C — Query the database directly (local only)

```bash
docker exec -it $(docker ps -q --filter ancestor=postgres:16) \
  psql -U indirectrates -d indirectrates \
  -c 'SELECT id, email, created_at FROM "user" ORDER BY created_at;'
```

---

## Common Setup Pattern (Shell Variables)

Set these once in your shell session and reuse them across all examples below:

```bash
# Local dev
export API_BASE="http://127.0.0.1:8000"

# Production
export API_BASE="https://your-backend.railway.app"

# Your token and user ID
export API_KEY="a3f8c2d1e4b79f6c..."
export FY_ID=7   # set after creating / listing fiscal years
```

---

## Endpoint Walkthroughs

### List Fiscal Years

```bash
curl -s "$API_BASE/api/fiscal-years" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

Response:
```json
[
  { "id": 7, "name": "FY2025", "start_month": "2025-01", "end_month": "2025-12" }
]
```

---

### Create a Fiscal Year

```bash
curl -s -X POST "$API_BASE/api/fiscal-years" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "FY2025", "start_month": "2025-01", "end_month": "2025-12"}' | jq .
```

Response:
```json
{ "id": 7, "name": "FY2025", "start_month": "2025-01", "end_month": "2025-12" }
```

```bash
export FY_ID=7
```

> Creating a fiscal year automatically seeds:
> - 5 default cost categories (Labor, ODC, Subcontractor, Travel, Other Direct)
> - 3 pool groups with default formulas (Fringe/TL, Overhead/DL, G&A/TCI)

---

### Import GL Actuals (row-level, editable in UI after import)

CSV format: `Period,Account,Amount,Entity`

```
Period,Account,Amount,Entity
2025-01,6001,125000.00,HQ
2025-01,6002,42000.00,HQ
2025-02,6001,131000.00,HQ
```

```bash
curl -s -X POST "$API_BASE/api/fiscal-years/$FY_ID/gl-entries/import" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@GL_Actuals.csv" | jq .
```

Response:
```json
{ "imported": 3, "errors": [] }
```

Any rows that fail validation are listed in `errors` (e.g. bad period format, non-numeric amount).

---

### Import Direct Costs (row-level, editable in UI after import)

CSV format: `Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel`

```
Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel
2025-01,PROJ-A,80000,1200,15000,5000,2000
2025-01,PROJ-B,45000,680,0,3000,500
```

```bash
curl -s -X POST "$API_BASE/api/fiscal-years/$FY_ID/direct-cost-entries/import" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@Direct_Costs_By_Project.csv" | jq .
```

---

### Upload a Blob File (Account Map, Scenario Events, or raw GL/DC fallback)

| `file_type` value | What it stores |
|---|---|
| `account_map` | Account_Map.csv — GL account → pool mappings |
| `scenario_events` | Scenario_Events.csv |
| `gl_actuals` | GL_Actuals.csv blob (used only if no row-level entries exist) |
| `direct_costs` | Direct_Costs_By_Project.csv blob (same fallback logic) |

```bash
# Upload Account Map
curl -s -X POST "$API_BASE/api/fiscal-years/$FY_ID/files?file_type=account_map" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@Account_Map.csv" | jq .
```

Response:
```json
{ "id": 12, "file_type": "account_map", "file_name": "Account_Map.csv", "size_bytes": 4096 }
```

---

### Run a Forecast

**DB mode** — uses data already in the database for this fiscal year:

```bash
curl -s -X POST "$API_BASE/forecast" \
  -H "Authorization: Bearer $API_KEY" \
  -F "fiscal_year_id=$FY_ID" \
  -F "scenario=Base" \
  -F "forecast_months=12" \
  -F "run_rate_months=3" \
  --output rate_pack_output.zip
```

**Upload mode** — send all CSV files directly (no fiscal year required):

```bash
curl -s -X POST "$API_BASE/forecast" \
  -F "scenario=Base" \
  -F "forecast_months=12" \
  -F "run_rate_months=3" \
  -F "gl_actuals=@GL_Actuals.csv" \
  -F "account_map=@Account_Map.csv" \
  -F "direct_costs=@Direct_Costs_By_Project.csv" \
  --output rate_pack_output.zip
```

The response is a ZIP archive containing the Excel workbook, PNG charts, and narrative.

---

### List and Export GL Entries

```bash
# List (paginated, 100 rows default)
curl -s "$API_BASE/api/fiscal-years/$FY_ID/gl-entries?limit=100&offset=0" \
  -H "Authorization: Bearer $API_KEY" | jq .

# Filter by period
curl -s "$API_BASE/api/fiscal-years/$FY_ID/gl-entries?period=2025-01" \
  -H "Authorization: Bearer $API_KEY" | jq .

# Get total row count
curl -s "$API_BASE/api/fiscal-years/$FY_ID/gl-entries/count" \
  -H "Authorization: Bearer $API_KEY" | jq .

# Export as CSV download
curl -s "$API_BASE/api/fiscal-years/$FY_ID/gl-entries/export" \
  -H "Authorization: Bearer $API_KEY" \
  --output GL_Actuals_export.csv
```

---

### Add / Update / Delete Individual GL Entries

```bash
# Add one entry
curl -s -X POST "$API_BASE/api/fiscal-years/$FY_ID/gl-entries" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"period": "2025-03", "account": "6001", "amount": 135000.00, "entity": "HQ"}' | jq .

# Update entry ID 42
curl -s -X PUT "$API_BASE/api/gl-entries/42" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"period": "2025-03", "account": "6001", "amount": 140000.00, "entity": "HQ"}' | jq .

# Delete entry ID 42
curl -s -X DELETE "$API_BASE/api/gl-entries/42" \
  -H "Authorization: Bearer $API_KEY" | jq .

# Delete ALL entries for a fiscal year (destructive — confirm required)
curl -s -X DELETE "$API_BASE/api/fiscal-years/$FY_ID/gl-entries?confirm=true" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

---

### Pool Setup (Indirect Rate Structure)

Pool groups (Fringe, Overhead, G&A) are seeded automatically. To inspect or extend:

```bash
# List rate groups
curl -s "$API_BASE/api/fiscal-years/$FY_ID/rate-groups" \
  -H "Authorization: Bearer $API_KEY" | jq .

# List pool groups (Fringe, Overhead, G&A)
curl -s "$API_BASE/api/fiscal-years/$FY_ID/pool-groups" \
  -H "Authorization: Bearer $API_KEY" | jq .

# List pools within a pool group
export POOL_GROUP_ID=3
curl -s "$API_BASE/api/pool-groups/$POOL_GROUP_ID/pools" \
  -H "Authorization: Bearer $API_KEY" | jq .

# Add a GL account to a pool
export POOL_ID=5
curl -s -X POST "$API_BASE/api/pools/$POOL_ID/gl-mappings" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"account": "6100", "is_unallowable": false, "notes": "Facilities rent"}' | jq .
```

---

### Reference Rates (Budget / Threshold)

```bash
# Upload a CSV of reference rates
# Format: rate_type,pool_group_name,period,rate_value
curl -s -X POST "$API_BASE/api/fiscal-years/$FY_ID/reference-rates/upload" \
  -H "Authorization: Bearer $API_KEY" \
  -F "file=@reference_rates.csv" | jq .

# Upsert a single rate
curl -s -X PUT "$API_BASE/api/fiscal-years/$FY_ID/reference-rates" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"rate_type": "budget", "pool_group_name": "Fringe", "period": "2025-01", "rate_value": 0.32}' | jq .

# List all reference rates
curl -s "$API_BASE/api/fiscal-years/$FY_ID/reference-rates" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

---

### Forecast History

```bash
# List past runs
curl -s "$API_BASE/api/fiscal-years/$FY_ID/forecast-runs" \
  -H "Authorization: Bearer $API_KEY" | jq .

# Download a run's ZIP output
export RUN_ID=4
curl -s "$API_BASE/api/forecast-runs/$RUN_ID/download" \
  -H "Authorization: Bearer $API_KEY" \
  --output forecast_run_$RUN_ID.zip

# Delete a run
curl -s -X DELETE "$API_BASE/api/forecast-runs/$RUN_ID" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

---

### Storage Usage

```bash
curl -s "$API_BASE/api/storage-usage" \
  -H "Authorization: Bearer $API_KEY" | jq .
```

Response:
```json
{ "used_bytes": 2097152, "limit_bytes": 104857600, "used_mb": 2.0, "limit_mb": 100.0 }
```

---

### Health Checks

```bash
curl $API_BASE/healthz   # → {"ok": true}  (always 200)
curl $API_BASE/readyz    # → {"ok": true}  (503 if DB unreachable)
```

---

## Python Helper Module

Save as `api_client.py` in the repo root:

```python
"""
Indirect Rates API client.

Usage:
    export API_BASE=https://your-backend.railway.app
    export API_KEY=your-token-here
    python api_client.py
"""

import os
import sys
import requests

API_BASE = os.environ.get("API_BASE", "http://127.0.0.1:8000").rstrip("/")
API_KEY  = os.environ.get("API_KEY", "")
HEADERS  = {"Authorization": f"Bearer {API_KEY}"}


def _get(path: str, **params):
    r = requests.get(f"{API_BASE}{path}", headers=HEADERS, params=params)
    r.raise_for_status()
    return r.json()


def _post(path: str, json=None, files=None, data=None):
    r = requests.post(f"{API_BASE}{path}", headers=HEADERS,
                      json=json, files=files, data=data)
    r.raise_for_status()
    return r.json()


# ── Fiscal Years ──────────────────────────────────────────────────────────────

def get_fiscal_years():
    return _get("/api/fiscal-years")


def create_fiscal_year(name: str, start_month: str, end_month: str) -> int:
    return _post("/api/fiscal-years",
                 json={"name": name, "start_month": start_month, "end_month": end_month})["id"]


# ── GL Entries ─────────────────────────────────────────────────────────────────

def import_gl_entries(fy_id: int, csv_path: str) -> dict:
    with open(csv_path, "rb") as f:
        return _post(f"/api/fiscal-years/{fy_id}/gl-entries/import",
                     files={"file": (os.path.basename(csv_path), f, "text/csv")})


def list_gl_entries(fy_id: int, period: str = "", account: str = "",
                    limit: int = 100, offset: int = 0) -> list:
    return _get(f"/api/fiscal-years/{fy_id}/gl-entries",
                period=period, account=account, limit=limit, offset=offset)


def export_gl_entries(fy_id: int, output_path: str = "GL_Actuals_export.csv") -> str:
    r = requests.get(f"{API_BASE}/api/fiscal-years/{fy_id}/gl-entries/export",
                     headers=HEADERS)
    r.raise_for_status()
    with open(output_path, "wb") as f:
        f.write(r.content)
    return output_path


# ── Direct Cost Entries ────────────────────────────────────────────────────────

def import_direct_costs(fy_id: int, csv_path: str) -> dict:
    with open(csv_path, "rb") as f:
        return _post(f"/api/fiscal-years/{fy_id}/direct-cost-entries/import",
                     files={"file": (os.path.basename(csv_path), f, "text/csv")})


# ── File Blobs ─────────────────────────────────────────────────────────────────

def upload_file(fy_id: int, file_path: str,
                file_type: str = "account_map") -> dict:
    with open(file_path, "rb") as f:
        r = requests.post(
            f"{API_BASE}/api/fiscal-years/{fy_id}/files",
            headers=HEADERS,
            params={"file_type": file_type},
            files={"file": (os.path.basename(file_path), f, "text/csv")},
        )
    r.raise_for_status()
    return r.json()


# ── Forecast ───────────────────────────────────────────────────────────────────

def run_forecast(fy_id: int, scenario: str = "Base",
                 forecast_months: int = 12, run_rate_months: int = 3,
                 output_path: str = "rate_pack_output.zip") -> str:
    r = requests.post(
        f"{API_BASE}/forecast",
        headers=HEADERS,
        data={"fiscal_year_id": fy_id, "scenario": scenario,
              "forecast_months": forecast_months, "run_rate_months": run_rate_months},
    )
    r.raise_for_status()
    with open(output_path, "wb") as f:
        f.write(r.content)
    return output_path


# ── Example workflow ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    if not API_KEY:
        sys.exit("Set API_KEY env var first")

    print("Fiscal years:", get_fiscal_years())

    fy_id = create_fiscal_year("FY2025", "2025-01", "2025-12")
    print(f"Created fiscal year ID: {fy_id}")

    print("GL import:", import_gl_entries(fy_id, "data/GL_Actuals.csv"))
    print("DC import:", import_direct_costs(fy_id, "data/Direct_Costs_By_Project.csv"))
    print("Account map:", upload_file(fy_id, "data/Account_Map.csv", "account_map"))

    out = run_forecast(fy_id, scenario="Base")
    print(f"Forecast ZIP saved to: {out}")
```

---

## CSV Format Reference

### GL_Actuals.csv
```
Period,Account,Amount,Entity
2025-01,6001,125000.00,HQ
2025-01,6002,42000.00,
```
- `Period` — `YYYY-MM` format, required
- `Account` — GL account number as text, required
- `Amount` — numeric (positive or negative), required
- `Entity` — optional division/department label

### Direct_Costs_By_Project.csv
```
Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel
2025-01,PROJ-A,80000,1200,15000,5000,2000
2025-02,PROJ-B,45000,680,0,3000,500
```
- All dollar/hour columns default to `0` if omitted

### Account_Map.csv
```
Account,Pool,BaseCategory,IsUnallowable,Notes
6001,Fringe,DL,FALSE,Payroll taxes
6100,Overhead,DL,FALSE,Facilities
6200,G&A,TCI,FALSE,Executive salaries
9999,Fringe,DL,TRUE,Entertainment (unallowable)
```
- `Pool` — must match a pool group name (`Fringe`, `Overhead`, `G&A`, or custom)
- `BaseCategory` — `DL`, `TL`, or `TCI`
- `IsUnallowable` — `TRUE`/`FALSE`

### Scenario_Events.csv
```
Scenario,EffectivePeriod,Type,Project,DeltaDirectLabor$,DeltaDirectLaborHrs,DeltaSubk,DeltaODC,DeltaTravel,DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes
Base,2025-01,ADJUST,,0,0,0,0,0,0,0,0,No changes
Upside,2025-06,ADJUST,PROJ-A,50000,750,0,0,0,0,0,0,New award
```

### Reference Rates CSV (for `/reference-rates/upload`)
```
rate_type,pool_group_name,period,rate_value
budget,Fringe,2025-01,0.32
budget,Overhead,2025-01,0.55
threshold,G&A,2025-01,0.18
```
- `rate_type` — `budget` or `threshold`
- `rate_value` — decimal (e.g. `0.32` = 32%)

---

## Error Reference

| Status | Code | Meaning | Fix |
|---|---|---|---|
| `401` | `unauthorized` | Missing or invalid auth | Check `API_KEY` and `Authorization` header |
| `403` | `forbidden` | Wrong user / not your data | Verify `API_KEY_USER_ID` matches the resource owner |
| `404` | `not_found` | ID does not exist | Confirm ID with the list endpoint |
| `413` | `payload_too_large` | Storage limit exceeded (100 MB) | Delete old forecast runs or uploaded files |
| `422` | `validation_error` | Bad request body | Check required fields; `Period` must be `YYYY-MM` |
| `429` | `rate_limited` | Too many requests | Authenticated: 20 req/min · Guest: 5 req/min |
| `503` | `service_unavailable` | Database unreachable | Check DB connection string and container status |
