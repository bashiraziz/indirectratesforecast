# PlannerAgent (Spec)

## Purpose
Choose the scenario plan to run (single scenario or all scenarios present), plus forecast horizon parameters.

## Inputs
- Scenario name (optional)
- `forecast_months`
- `run_rate_months`
- `Scenario_Events.csv` (to discover scenario names when not provided)

## Outputs
- `ScenarioPlan`: scenarios list + parameters

## Implementation Mapping
- Primary: `src/indirectrates/agents.py` → `PlannerAgent.plan(...)`

## Acceptance Criteria
- If a scenario is provided: run exactly that scenario.
- If no scenario is provided and `Scenario` column exists: run all unique scenario names.
- If no scenario is provided and no `Scenario` column exists: default to `Base`.
