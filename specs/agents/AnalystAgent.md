# AnalystAgent (Spec)

## Purpose
Compute pools/bases/rates by period, apply scenario events, and calculate project impacts.

## Inputs
- Input datasets (CSVs)
- Rate configuration (pool/base definitions)
- Scenario plan

## Outputs
- `ForecastResult` per scenario:
  - Pools by period
  - Bases by period
  - Rates by period
  - Project impacts by period
  - Assumptions + warnings

## Implementation Mapping
- Orchestration: `src/indirectrates/agents.py` → `AnalystAgent.run(...)`
- Skills called:
  - `normalize_inputs`: `src/indirectrates/normalize.py`
  - `map_accounts_to_pools`: `src/indirectrates/mapping.py`
  - `compute_actual_aggregates`, `build_baseline_projection`, `apply_scenario_events`, `compute_rates_and_impacts`: `src/indirectrates/model.py`

## Acceptance Criteria
- Rates are computed as `pool/base` per period.
- Unallowables are excluded per config/mapping.
- Scenario deltas change both:
  - pool dollars (numerator), and
  - project direct costs (denominator drivers)
- Results are reproducible from the same inputs.
