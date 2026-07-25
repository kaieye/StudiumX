# Slice S10 — code-arch-improve (read-only)

**Agent:** Grok Build (code-arch-improve)
**Revision:** HEAD `d9435064`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S10

Shared teaching contracts: teaching-types/**, teaching-events, teaching-settings-schema, features, secret-presence, provider-custom-headers, agent-sandbox types.

### Scope

| Item | Value |
| --- | --- |
| Population | ~12.8k LOC teaching contracts |
| Examined | events, settings schema, agent-sandbox dual-axis, toolsReplayed literals, features, secret-presence, headers, event-density |
| ADRs | 0015, 0009–0011, 0025, 0073, 0075, 0148/0149, 0152/0153 |

**approx_lines_examined:** **~12800**  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- teaching-events deep protocol: create/parse fail-closed; single author path.
- Settings schema pure (no FS/electron); tools.enabled default false.
- Sandbox × approval dual axis; no YOLO product labels.
- toolsReplayed: false encoded as type literal.
- Features metadata-only; secret-presence presence-only; headers strip spoof.

### Negative evidence

- Peel events for LOC fails cost gate.
- Incomplete barrel is intentional import-by-path design.
- TeachingSystemApi width is product surface growth.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Events / settings / domain types / policies split |
| Interface depth | **Healthy** | create/parse/normalize hide validators |
| Seam legitimacy | **Healthy** | Pure schema vs main secrets |
| Test surface | **Healthy** | Events, settings schema, density units |
| Conceptual integrity | **Healthy** | ADR language matches |
| Cost proportionality | **Healthy** | Size-only peels negative NPV |

### Candidates

**0 candidates**.

**Reopen if:** second event author; settings schema gains FS/secrets; toolsReplayed or YOLO product paths; system-api dual-edit thrash of one invariant.
