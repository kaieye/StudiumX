# Slice S08 — code-arch-improve (read-only)

**Agent:** /root (main; subagent brief-delivery failed for s08_pass1)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S08

`src/main/mcp/**` + `src/shared/mcp/**` — host, session manager, OAuth/secrets, marketplace foundation, import-export, effect map, public types.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | **~11.0k** across **44** files |
| Expansion hop | Settings `UserMcpSettingsSection` (list/editor/import/OAuth only); ADR-0142; registry-inject into tools |
| ADRs | **0132** parity + trust; **0140** marketplace foundation; **0141** experience; **0142 settings-only product surface** (no marketplace Settings page); 0075 size |
| Product floor | Secrets never in public DTO/Doctor; MCP not teaching evidence; tools still effect lattice + approval; **no YOLO**; Settings = list/editor/import/OAuth |
| History | MCP settings land → Zcode A–H productization → workbench drop orphan marketplace UI (`7b5e67ed`) — product surface intentionally narrowed |
| Tests | `mcp-host`, `mcp-session-manager`, `mcp-host-product-closeout`, OAuth token store units |

**Material evidence**

- **Host** (`host.ts`): composition root — config store, secret env, OAuth manager, session manager, plugin registry, marketplace store; `getPublicConfig` / `getEffectiveViewPublic` / `getDoctorHostAggregates` are secret-free projections; `autoConnectNow` is discovery-only (testServer / tools-list, not tools/call).
- **Session manager** (`session-manager.ts:1-3`): deep lifecycle + tools/list cache + budgets; default MCP effect fail-closed privileged; remote readOnlyHint gated.
- **Marketplace store**: foundation retained (ADR-0140); host methods exist; **ADR-0142** freezes no Settings marketplace UI. Renderer confirms: `UserMcpSettingsSection` header "No marketplace UI"; SettingsView wires `section === mcp` to list/editor path only.
- **Import-export / config-schema / effect-map / redact / secret-merge**: legitimate ownership splits for parse, public view, and secret handling.
- **Product closeout** tests + ADR-0142 prevent re-adding half marketplace Settings pages without a new ADR.

**Negative evidence**

- Session-manager ~1396 LOC is budget/lifecycle density; size alone is not a candidate (ADR-0075). No dual-signal evidence that callers re-implement connect/list/cache invariants.
- Deleting marketplace foundation because no UI would be speculative demolition contradicting ADR-0142 section 5 (retain foundation).
- No evidence secrets appear in Doctor aggregates (counts/flags only at host).

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Host composition vs session lifecycle vs OAuth/secrets vs marketplace store vs shared schema already separated |
| Interface depth | **Healthy** | Settings/IPC use public config/effective view/runtime list; connect budgets, secret merge, normalize stay inside main |
| Seam legitimacy | **Healthy** | Multi-source config, OAuth, transport, marketplace foundation vs Settings product surface — domain-real; ADR-0142 freezes the product seam |
| Test surface | **Healthy** | Host/session/product-closeout units exercise public interfaces |
| Conceptual integrity | **Healthy** | ADR-0142 + Settings header + AGENTS floor agree: foundation OK, no marketplace Settings page |
| Cost proportionality | **Healthy** | Keeping foundation without Settings UI is deliberate; purity peel of session-manager without recurrence is negative NPV |

### Candidates

**0 candidates** (none admitted under skill gates).

**Reopen later only if:** (1) Settings reintroduces marketplace grid without new ADR; (2) secrets appear in public DTO/Doctor/bundle; (3) MCP results treated as teaching evidence or bypass effect/approval; (4) session-manager thrash forces repeated dual-edits with host for one product change.

### Metrics for tracker

- approx_lines_examined: **11038**
- files_examined: **44 primary + Settings hop**
- candidate_count: **0**
- status_for_tracker: **good_enough**
