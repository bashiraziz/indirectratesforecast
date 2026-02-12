# Skill: build_baseline_projection

## Purpose
Extend actuals into the future using a simple run-rate model (rolling mean).

## Inputs
- Actual pools, bases, and direct-by-project
- `forecast_months`
- `run_rate_months`

## Outputs
- `Projection` with pools/bases projected through the horizon
- assumptions (method + parameters)

## Implementation
- `src/indirectrates/model.py` → `build_baseline_projection(...)`
