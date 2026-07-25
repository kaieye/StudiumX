# Slice S08 — code-arch-improve (read-only re-review)

**Agent:** Grok Build (code-arch-improve)
**Revision:** HEAD `d9435064`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S08

`src/main/mcp/**` + `src/shared/mcp/**` — host, session manager, OAuth/secrets, marketplace foundation, import-export, effect map, public types / IPC contract.

### Scope

| Item | Value |
| --- | --- |
| Primary paths | `src/main/mcp/**`, `src/shared/mcp/**` |
| Expansion hop | Settings MCP section; ADR-0142; tool-bridge → registry/effect-policy |
| ADRs | 0132, 0140, 0141, 0142, 0075 |
| Product floor | Secrets never in public DTO/Doctor; MCP ≠ teaching evidence; effect lattice; no YOLO; Settings = list/editor/import/OAuth |

**approx_lines_examined:** **~11000**  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- Host is composition root with secret-free public/doctor projections; marketplace install does not bypass approval.
- IPC gateway projects public shapes only.
- Session manager lifecycle density is product complexity, not missing seam.
- Tool bridge registers into normal registry; fail-closed privileged default.
- ADR-0142 Settings surface: list/editor/import/OAuth only; no marketplace Settings UI in renderer.
- Foundation marketplace store/IPC retained per ADR-0142 §5 — intentional, not half-finished product surface.

### Negative evidence

- Peel session-manager by LOC alone fails ADR-0075.
- Delete marketplace foundation contradicts ADR-0142.
- Merge host+gateway worsens locality.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Host vs session vs OAuth vs marketplace store vs shared schema |
| Interface depth | **Healthy** | Public config / effective view hide secret merge |
| Seam legitimacy | **Healthy** | Product surface freeze vs foundation retention is domain-real |
| Test surface | **Healthy** | Host + product-closeout units |
| Conceptual integrity | **Healthy** | ADR-0142 + Settings + AGENTS agree |
| Cost proportionality | **Healthy** | Foundation without Settings UI is deliberate |

### Candidates

**0 candidates**.

**Reopen if:** Settings reintroduces marketplace without ADR; secrets in public DTO; MCP as teaching evidence; dual-edit thrash host/session; marketplace IPC security footgun.
