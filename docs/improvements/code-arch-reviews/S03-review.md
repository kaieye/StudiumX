# Slice S03 — code-arch-improve (read-only re-review)

**Agent:** Grok Build (code-arch-improve)
**Revision:** HEAD `d9435064`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S03

Teaching IPC / doctor / support / capability: commands, gateway, doctor, support-bundle, capability-catalog, doctor-config-facts, teaching-ipc-contract.

### Scope

| Item | Value |
| --- | --- |
| Primary | teaching-ipc-commands(+peels), teaching-ipc-gateway, teaching-doctor, support-bundle, teaching-capability-catalog, observability fact collectors, shared teaching-ipc-contract |
| ADRs | 0022, 0027, 0034, 0084, 0093, 0107, 0119, 0120, 0075 |
| Floor | Settlement sole-writer prefer-host; secrets never in Doctor/support; no YOLO; autoRepair disabled |

**approx_lines_examined:** **~5800**  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- Gateway is composition wiring: parser → action → reply; parse-before-side-effect.
- commitLearningOutcome prefers turnCoordinatorHost.
- CAS expectedRevision flows through parsers.
- IPC peels (turn-review, agent-conversation) already landed.
- Doctor pure checks + re-redact export; fact collectors presence-only.
- Support bundle consent-gated export; capability catalog read-only TTL readiness.

### Negative evidence

- Further gateway split is size-only.
- Registry generator for IPC is hypothetical seam.
- Contract+gateway co-change is allowlist discipline, not dual ownership thrash.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Parsers / gateway / doctor / bundle / catalog split |
| Interface depth | **Healthy** | Narrow parsers + host commit + pure doctor |
| Seam legitimacy | **Healthy** | Sole-writer, exact envelopes, consent export |
| Test surface | **Healthy** | check:teaching-ipc-*, doctor, support, catalog |
| Conceptual integrity | **Healthy** | ADR language matches headers |
| Cost proportionality | **Healthy** | Machinery earns cost at IPC/privacy surface |

### Candidates

**0 candidates**.

**Reopen if:** settlement bugs outside gateway→host; parsers accept renderer evidence; secret leak in Doctor/support; capability TTL stale incidents need new ownership.
