# Architecture Spec (MVP)

## Goal
Forecast GovCon-style indirect rates (Fringe / Overhead / G&A) by month, apply scenario deltas, and produce a management pack with traceability.

## Components
### Forecast Engine (Python)
- Core pipeline: `src/indirectrates/agents.py`
- Data normalization: `src/indirectrates/normalize.py`
- Account mapping: `src/indirectrates/mapping.py`
- Forecast + scenario model: `src/indirectrates/model.py`
- Packaging (Excel + charts + narrative): `src/indirectrates/reporting.py`

### API (Python / FastAPI)
- Endpoint: `src/indirectrates/server.py`
- `POST /forecast` accepts inputs and returns an output zip.

### UI (Next.js)
- App UI: `web/app/page.tsx`
- Forecast proxy route: `web/app/api/forecast/route.ts`
- Hosted ChatKit session route: `web/app/api/chatkit/session/route.ts`

## Data Contracts (MVP)
Inputs are CSVs (or a zip containing them):
- `GL_Actuals.csv`: `Period,Account,Amount[,Entity]`
- `Account_Map.csv`: `Account,Pool,BaseCategory,IsUnallowable,Notes`
- `Direct_Costs_By_Project.csv`: `Period,Project,DirectLabor$,DirectLaborHrs,Subk,ODC,Travel`
- `Scenario_Events.csv`: `Scenario,EffectivePeriod,Type,Project,Delta...`

## Auditability
Non-negotiables for GovCon credibility:
- Every rate is computed as `pool/base` by period.
- Scenario deltas are explicit, period-effective, and reproducible.
- Outputs include assumptions and a run ledger (MVP: `assumptions.json` + per-scenario folders).

## What “Claude Sub-Agents / Skills” Means Here
This repo provides:
- Agent role specs (Planner/Analyst/Reporter).
- Skill specs mapped to concrete Python functions.

It does **not** include a Claude runtime/orchestrator; if you later add Claude Code / Anthropic orchestration, these docs become your “sub-agent” and “skill” prompt sources.
