# Spec-kit (lightweight, repo-local)

This folder is the project’s **spec-kit**: human-readable specs (Markdown-first) that describe agents, reusable skills, and task templates.

It’s designed so you can:
- Run the app normally (Python + Next.js) without an LLM runtime.
- Still have “Claude-style” agent/sub-agent artifacts (roles + skills) ready for a Claude orchestrator later.

## Agents
- `PlannerAgent`: scenario set selection and run configuration.
- `AnalystAgent`: ingestion, normalization, forecasting, scenario application, rate math.
- `ReporterAgent`: charts, Excel pack, narrative, and run ledger.

## Skills
Skills are small, testable functions the agents call (loading, mapping, aggregation, scenario apply, explainability).

Start here: `specs/INDEX.md`.
