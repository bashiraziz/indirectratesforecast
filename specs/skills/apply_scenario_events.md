# Skill: apply_scenario_events

## Purpose
Apply scenario deltas (WIN/LOSE/HIRE/etc.) from `Scenario_Events.csv` to future periods.

## Inputs
- Baseline `Projection`
- Scenario events table
- Scenario name

## Outputs
- Updated `Projection` with adjusted pools and direct-by-project, with bases recomputed to reconcile.

## Invariants
- Events apply from `EffectivePeriod` forward.
- Bases reconcile to the direct-by-project table after deltas.

## Implementation
- `src/indirectrates/model.py` → `apply_scenario_events(...)`
