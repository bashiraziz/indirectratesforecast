# Indirect Rate Forecasting Agent (GovCon-ready MVP)

This repo is a Codex-friendly MVP for forecasting provisional indirect rates (Fringe / Overhead / G&A), running simple scenarios, and generating a management pack (Excel + charts + narrative).

## Quickstart

```powershell
python -m venv .venv
.venv\\Scripts\\Activate.ps1
pip install -e ".[dev]"
indirectrates synth --out data --start 2025-01 --months 18 --projects 5 --seed 42
indirectrates run --input data --out out --scenario Base
```

## Web UI (Vercel-friendly)

This repo includes a Next.js UI in `web/` (meant to be deployed to Vercel). It talks to a small Python API that runs the forecast engine.

Run locally (2 terminals):

```powershell
# terminal 1: Python API
pip install -e ".[server]"
indirectrates serve
```

```powershell
# terminal 2: Next.js UI
cd web
npm install
npm run dev
```

Open `http://localhost:3000`.

Outputs land in `out/`:
- `rate_pack.xlsx`
- `narrative.md`
- `assumptions.json`
- `charts/*.png`

## Inputs (CSVs)

Minimal demo schema (monthly `Period` as `YYYY-MM`):
- `GL_Actuals.csv`: `Period,Account,Amount[,Entity]`
- `Account_Map.csv`: `Account,Pool,BaseCategory,IsUnallowable,Notes`
- `Direct_Costs_By_Project.csv`: `Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel`
- `Scenario_Events.csv`: `Scenario,EffectivePeriod,Type,Project,DeltaDirectLabor$,DeltaDirectLaborHrs,DeltaSubk,DeltaODC,DeltaTravel,DeltaPoolFringe,DeltaPoolOverhead,DeltaPoolGA,Notes`

## Config

Rate structure is configurable via `configs/default_rates.yaml` (pool/base definitions vary by contractor).

## Spec-kit (agents + skills)

Specs are maintained in Markdown under `specs/`:
- Start here: `specs/INDEX.md`
- Agents (sub-agents): `specs/agents/PlannerAgent.md`, `specs/agents/AnalystAgent.md`, `specs/agents/ReporterAgent.md`
- Skills (reusable): `specs/skills/README.md`
