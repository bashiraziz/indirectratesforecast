# Skill: map_accounts_to_pools

## Purpose
Join GL rows to a pool classification via `Account_Map.csv` and flag missing mappings.

## Inputs
- GL actuals DataFrame
- Account map DataFrame

## Outputs
- Mapped GL DataFrame with `Pool` + `IsUnallowable` + warnings

## Invariants
- Unmapped accounts are flagged and excluded from pools.

## Implementation
- `src/indirectrates/mapping.py` → `map_accounts_to_pools(...)`
