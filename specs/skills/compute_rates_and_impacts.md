# Skill: compute_rates_and_impacts

## Purpose
Compute indirect rates from pool/base definitions and calculate project-level impacts using those rates.

## Inputs
- Scenario `Projection`
- Rate config (`rates: {name: {pool, base}}`)

## Outputs
- `rates` (Period × RateName)
- `project_impacts` (Period, Project, LoadedCost$ breakdown)

## Implementation
- `src/indirectrates/model.py` → `compute_rates_and_impacts(...)`
