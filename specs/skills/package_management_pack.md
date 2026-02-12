# Skill: package_management_pack

## Purpose
Generate management-facing deliverables (Excel + charts + narrative + assumptions) for one or more scenarios.

## Inputs
- `ForecastResult` list
- Output directory

## Outputs
- `rate_pack.xlsx`, `charts/*.png`, `narrative.md`, `assumptions.json`, plus per-scenario subfolders

## Implementation
- `src/indirectrates/agents.py` → `ReporterAgent.package(...)`
- `src/indirectrates/reporting.py`
