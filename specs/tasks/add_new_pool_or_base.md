# Task: Add a New Pool or Base

## Goal
Add a new pool/base definition (e.g., “Facilities” pool over “SquareFeet” base) without breaking existing rate math.

## Steps
1. Extend input schema (if needed) to include the new base driver.
2. Update rate config (YAML) to define the new base and rate.
3. Update aggregation logic so the base is computed and available by period.
4. Add a test to verify `pool/base` identity for the new rate.

## Files Typically Touched
- Config: `configs/default_rates.yaml` (or packaged `src/indirectrates/resources/default_rates.yaml`)
- Model aggregation: `src/indirectrates/model.py`
- Tests: `tests/test_mvp_pipeline.py`

## Acceptance Criteria
- New rate appears in outputs (Excel, charts).
- New rate is traceable: pool and base sources are explicit.
