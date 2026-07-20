# RESULT — P2-04 Conservative Parallel Read Tools

## Summary

Added a conservative parallel dispatcher for **pure-read tools only**. Mixed batches deny non-read tools (`workspace_write` / `external_write` / `privileged`) without executing them, and still parallelize pure reads under bounded concurrency (default 4, max 8). Concurrent same-path reads are allowed. Sequential agent-loop is unchanged (opt-in helper only).

## Files

| Path | Role |
|------|------|
| `src/main/ai/tools/parallel-read-dispatcher.ts` | `dispatchReadToolsInParallel`, path target helpers, concurrency clamp |
| `src/main/ai/tools/execution.ts` | Re-exports parallel helpers for opt-in callers |
| `tests/unit/parallel-read-tools.unit.test.ts` | Concurrency measurement + deny cases |
| `scripts/check-parallel-read-tools.mjs` | Source + unit gate |
| `package.json` | `check:parallel-read-tools` script |

## Behavior

- **Pre-check**: `classifyToolEffect(name) === 'read'` required to run.
- **Non-read**: status `denied`, code `parallel_read_only`, handler never called.
- **Reads**: bounded `Promise.all` workers; order of `ToolOutcome[]` matches input `calls`.
- **Same-path concurrent reads**: allowed (reads only).
- **Empty batch**: `[]`.
- **Aborted signal**: cancelled without running.
- **Agent loop**: not switched to parallel by default.

## Verify

```bash
CI=true node ./node_modules/vitest/vitest.mjs run --project unit tests/unit/parallel-read-tools.unit.test.ts
node scripts/check-parallel-read-tools.mjs
# or
pnpm run check:parallel-read-tools
```

## Notes

- Worktree needs `node_modules` (junction to main repo is fine, same as other worktrees).
- Do not commit `_P2_BRIEF.md` or the `node_modules` junction if it is untracked local setup.
