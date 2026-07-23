# Slice S07 — code-arch-improve (read-only)

**Agent:** /root (main; subagent brief-delivery failed for s07_pass1)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S07

`src/main/ai/tools/**` — registry, dispatcher, effect/policy, approval receipts, write policy, batch/parallel dispatch, workspace/web/memory/MCP tool handlers.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | **~7.5k** across **32** files |
| Expansion hop | `docs/tools/TOOL_CONTRACT.md`; agent-loop callers of dispatcher/registry; MCP bridge inject (out of product shell path) |
| ADRs | **0024** typed dispatcher + effect; **0041** annotations/budget; **0048** write policy; **0061** capabilities; **0063** declarative tool policy; 0075 size |
| Product floor | Effect lattice `read` / `workspace_write` / `external_write` / `privileged`; **no shell product tool**; **no YOLO**; MCP tools still through effect + approval + ToolOutcome |
| History | `b4f3c9c8` typed dispatcher; `f87209b4` parallel read; `5ed5d308` approval receipts; `cb9f33ef` write rewind / memory; policy inject landings — intentional peels, not shallow thrash |
| Tests | `tool-dispatcher`, `tool-policy`, `tool-policy-fs`, catalog/secondary/runtime policy-inject units |

**Material evidence**

- **ToolOutcome + effect class** (`tool-outcome.ts:9-11`): lattice is the shared vocabulary; status is source of truth (not free-text error sniffing).
- **Dispatcher** (`dispatcher.ts:1-6, 44-47`): deep thin orchestration — effect auth → strict args parse → handler → ToolOutcome; does **not** register shell/MCP; does not replace registry permission gates.
- **Effect policy** (`effect-policy.ts`): orthogonal pre-execution allow for effect class / tool allow-list vs interactive permission gate.
- **Registry** (`registry.ts`): permission descriptors, grants, tool context, policy document inject (ADR-0063), forced-human memory tools → approval receipts.
- **Write policy** (`write-policy.ts`): pure relative-path advisory (`allow`/`ask`/`deny`); FS checks caller-owned — deletion test: path normalization + mode rules would scatter into handlers.
- **Approval receipts** (`approval-receipt.ts`): append-only JSONL; `reusableAuthorization: false`, `oneShot: true` — receipts are not auth tokens.
- **Batch / parallel-read dispatchers**: real concurrency seams with demonstrated variation (serial vs parallel read-safe tools).

**Negative evidence**

- Further merging of policy + dispatcher or splitting workspace.ts (~874) by size alone lacks dual independent friction signals this rev.
- No YOLO / shell tool registration in product path observed in this slice contract surface.
- TOOL_CONTRACT + check scripts already gate registry drift.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Effect auth, args parse, policy, receipts, write policy, handlers already modular; history peels land by touch |
| Interface depth | **Healthy** | Callers use `ToolDispatcher.dispatch` / registry build + permission resolver; lattice + strictest-wins policy hidden |
| Seam legitimacy | **Healthy** | Effect class, interactive permission, declarative document, receipt ledger, parallel-read — domain-real variation |
| Test surface | **Healthy** | Dispatcher/policy/inject units cross the same interfaces |
| Conceptual integrity | **Healthy** | TOOL_CONTRACT + ADR-0024/0048/0063 agree with code headers (no argv/shell prefix rules) |
| Cost proportionality | **Healthy** | Existing lattice machinery earns its cost; purity re-partition of 7.5k without recurrence is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) a product shell/YOLO path is proposed (reject under floor, not deepen); (2) permission + effect decisions repeatedly diverge causing dual-edit bugs; (3) workspace tool handler growth forces coordinated policy/registry changes for one product feature beyond intentional co-change.

### Metrics for tracker

- approx_lines_examined: **7476**
- files_examined: **32 primary + hop samples**
- candidate_count: **0**
- status_for_tracker: **good_enough**
