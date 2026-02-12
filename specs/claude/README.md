# Claude Sub-Agents & Skills (Prompt Kit)

These files are **prompt templates** you can use in Claude (or any LLM orchestrator) to run this project with “sub-agents”.

They do not run by themselves. The actual execution happens in code:
- Forecast engine: `src/indirectrates/*`
- API: `src/indirectrates/server.py`
- UI: `web/*`

## Sub-agents
- `specs/claude/subagents/planner.md`
- `specs/claude/subagents/analyst.md`
- `specs/claude/subagents/reporter.md`

## Skills
Skills are defined as concrete, testable behaviors and mapped to code in:
- `specs/skills/README.md`

## Recommended Orchestration Flow
1. Planner: confirm scenario set + horizon + deliverables.
2. Analyst: implement/modify ingestion + model logic, add tests.
3. Reporter: update packaging outputs + narrative expectations.
4. Run validation: `python -m pytest` and a UI smoke run.
