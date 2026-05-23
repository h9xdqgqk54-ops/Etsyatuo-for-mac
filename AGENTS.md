# Codex Project Instructions

## Persistent context
At the start of every session, read CODEX_HANDOFF.md if it exists.

## Workflow
- First inspect repository state with git status and git diff.
- Summarize current state before making changes.
- Prefer minimal, reversible changes.
- After each change, run the narrowest relevant test first.
- Do not perform broad refactors unless explicitly requested.

## Failure handling
If blocked, stop and report:
- what was attempted
- exact command output or error
- current hypothesis
- what input is needed from the user
