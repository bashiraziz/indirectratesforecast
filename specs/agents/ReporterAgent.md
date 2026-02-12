# ReporterAgent (Spec)

## Purpose
Package outputs for management:
- Excel rate pack (tables)
- Rate curve charts
- Short narrative + assumptions JSON

## Inputs
- `ForecastResult` list (one per scenario)

## Outputs
- `rate_pack.xlsx`
- `charts/*.png`
- `narrative.md`
- `assumptions.json`
- Per-scenario folders under `out/` (same artifacts)

## Implementation Mapping
- `src/indirectrates/agents.py` → `ReporterAgent.package(...)`
- `src/indirectrates/reporting.py`

## Acceptance Criteria
- Outputs can be regenerated deterministically.
- Excel export must not contain non-Excel types (e.g., pandas `Period`).
