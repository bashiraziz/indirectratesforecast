# Skill: normalize_inputs

## Purpose
Standardize period columns, fill missing optional columns, and validate required columns.

## Inputs
- DataFrames: GL actuals, account map, direct costs, scenario events

## Outputs
- Normalized DataFrames + warnings list

## Invariants
- `Period` and `EffectivePeriod` (when present) are month Periods.
- Required columns exist, else error.

## Implementation
- `src/indirectrates/normalize.py` → `normalize_inputs(...)`
