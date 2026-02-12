# Skill: compute_actual_aggregates

## Purpose
Aggregate actual pools and bases by period and standardize direct cost columns used for bases and impacts.

## Inputs
- Mapped GL DataFrame
- Direct costs DataFrame
- Rate config (unallowables)

## Outputs
- `pools` (Period × PoolName)
- `bases` (Period × BaseKey)
- `direct_by_project` (Period, Project, cost columns)
- warnings

## Implementation
- `src/indirectrates/model.py` → `compute_actual_aggregates(...)`
