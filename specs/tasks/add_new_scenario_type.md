# Task: Add a New Scenario Event Type

## Goal
Add a scenario type beyond the current delta fields (e.g., “HIRE ramp” that gradually changes base/pool over N months).

## Steps
1. Define the new event payload fields in `Scenario_Events.csv`.
2. Extend `apply_scenario_events` to interpret the event across periods.
3. Add a test that validates directionality and reconciliation.

## Acceptance Criteria
- Scenario deltas are applied deterministically from `EffectivePeriod`.
- Bases and impacts reconcile after application.
