# Task: Onboard a New Client Export Format

## Goal
Support a new CSV export shape for one of the inputs (GL, labor, direct costs, scenario events).

## Steps
1. Capture a representative sample (with redactions).
2. Add an adapter/transform step into `normalize_inputs` or a new IO helper.
3. Add unit tests with a small fixture representing the new format.
4. Confirm the end-to-end pipeline still runs on the synthetic dataset.

## Acceptance Criteria
- New export loads without manual editing.
- Mapping/unallowable rules still apply correctly.
