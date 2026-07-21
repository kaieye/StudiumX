# ADR-0048: Tool contract and pure workspace-write policy

- Status: accepted and implemented
- Scope: registered teaching-tool inventory and an advisory, pure workspace-write decision layer

## Decision

The repository maintains `docs/tools/TOOL_CONTRACT.md` as the reviewable contract for every registered tool. Each entry declares the effect class from the existing lattice (`read`, `workspace_write`, `external_write`, or `privileged`), its bounded snip/projection stance, and capability notes. `scripts/check-tool-contract.mjs` fails on drift. Unknown tools remain fail-closed as `privileged`; this ADR does not weaken `effect-policy.ts` or remove its capability catalog.

Workspace write policy is implemented in `src/main/ai/tools/write-policy.ts` as pure functions. It accepts a relative path, overwrite intent, approval mode, deny globs, and ask globs and returns `allow`, `ask`, or `deny`. Priority is deny > ask > allow > fallback. Absolute/escaping paths deny; deny globs deny; ask globs and risky overwrite ask; full access may allow overwrite. The function is advisory: the caller must still perform real workspace containment, target-type validation, durable publication, and interactive permission resol
