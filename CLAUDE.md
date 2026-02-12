# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GovCon MVP that forecasts provisional indirect rates (Fringe, Overhead, G&A) by month, applies scenario variations, and generates a management pack (Excel + charts + narrative). Stateless, input-driven, no database.

## Commands

### Python setup and CLI
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"            # core + pytest
pip install -e ".[server]"         # adds FastAPI/uvicorn
```

```bash
# Generate synthetic test data
indirectrates synth --out data --start 2025-01 --months 18 --projects 5 --seed 42

# Run forecast pipeline
indirectrates run --input data --out out --scenario Base

# Start API server (http://127.0.0.1:8000/docs)
indirectrates serve
```

### Tests
```bash
pytest tests                       # run all tests
pytest tests/test_mvp_pipeline.py::test_end_to_end_base   # single test
```

### Web UI (Next.js)
```powershell
cd web
npm install
npm run dev       # http://localhost:3000
npm run build     # production build
npm run lint      # ESLint
```

## Architecture

### Three-Agent Pipeline

The forecast engine (`src/indirectrates/agents.py`) uses three sequential agents, each a plain Python class:

1. **PlannerAgent** — Selects scenarios from `Scenario_Events.csv` (or takes explicit scenario name), sets `forecast_months` and `run_rate_months`.
2. **AnalystAgent** — Loads CSVs → normalizes periods → maps GL accounts to cost pools → aggregates → projects forward via run-rate average → applies scenario deltas → computes rates as `pool$ / base$`.
3. **ReporterAgent** — Writes Excel workbook, PNG charts, markdown narrative, and `assumptions.json`.

### Core Modules (src/indirectrates/)

| Module | Role |
|---|---|
| `types.py` | Frozen dataclasses: `Inputs`, `ForecastResult`, `Projection` |
| `io.py` | CSV loading (GL, Account_Map, Direct_Costs, Scenario_Events) |
| `normalize.py` | Period string → pandas `Period` conversion |
| `mapping.py` | GL Account → Pool mapping with unallowable filtering |
| `model.py` | Forecasting math: aggregation, run-rate projection, scenario event application, rate computation |
| `config.py` | Parses `configs/default_rates.yaml` into `RateConfig` |
| `reporting.py` | Excel (openpyxl), matplotlib charts, markdown narrative |
| `synth.py` | Generates synthetic datasets for testing |
| `server.py` | FastAPI `POST /forecast` endpoint (accepts zip/CSVs, returns output zip) |
| `cli.py` | Typer CLI entry point (`synth`, `run`, `serve` commands) |

### Web UI (web/)

Next.js 15 / React 19 app. `web/app/page.tsx` is the main UI (upload CSVs or zip, set parameters, preview results). `web/app/api/forecast/route.ts` proxies FormData to the Python FastAPI backend. Optional OpenAI ChatKit integration via `OPENAI_API_KEY` and `CHATKIT_WORKFLOW_ID` env vars.

### Rate Calculation Flow

1. Load CSVs and normalize `YYYY-MM` periods to pandas `Period`
2. Map GL accounts to cost pools (Fringe, Overhead, G&A) via `Account_Map.csv`
3. Aggregate pool dollars and base dollars (DL, TL, TCI) by period
4. Project forward using `tail(run_rate_months).mean()` for each pool and base
5. Apply scenario events (period-effective deltas to pools and project direct costs)
6. Compute rates: `rate = pool$ / base$` per period per rate type

### Rate Configuration

`configs/default_rates.yaml` defines base definitions (DL, TL, TCI) and rate mappings (which pools and bases compute each rate). This is the primary extension point for adding new rate types.

## Input CSV Schema

All CSVs use monthly `Period` as `YYYY-MM`:
- **GL_Actuals.csv**: `Period,Account,Amount[,Entity]`
- **Account_Map.csv**: `Account,Pool,BaseCategory,IsUnallowable,Notes`
- **Direct_Costs_By_Project.csv**: `Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel`
- **Scenario_Events.csv**: `Scenario,EffectivePeriod,Type,Project,Delta*` columns

## Design Principles

- **Frozen dataclasses** throughout for auditability and immutability
- **Auditability is non-negotiable**: every rate is `pool/base` by period, scenario deltas are explicit and reproducible, assumptions are logged
- Agent specs in `specs/agents/` and skill specs in `specs/skills/` are designed to be prompt sources for future Claude orchestration
- Python 3.10+ required; Windows (PowerShell) is the primary development environment
