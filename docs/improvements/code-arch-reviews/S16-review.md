# Slice S16 — code-arch-improve (read-only)

**Agent:** Grok Build (code-arch-improve)
**Revision:** HEAD `d9435064`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S16

1. Residual renderer: settings / pet / app-shell (reaffirm).
2. **NEW:** web-remote-control (ADR-0143 Phase 0/1) across main / shared / renderer / preload.

### Scope

| Item | Value |
| --- | --- |
| Deep paths | `src/main/web-remote-control/**`, `src/shared/web-remote-control/**`, renderer remote-control + RemoteControl settings, preload, check-web-remote-control |
| Residual | SettingsView/MCP, appStore, App.tsx, pet, outcome-commit client |
| ADRs | 0143 LAN remote; feature under_development; no default cloud relay; secret-free status |

**approx_lines_examined:** **~25000** (remote ~2.5k deep + residual ~22.7k context)  
**candidate_count:** **0**  
**status:** **good_enough**

### Material evidence

- Main manager sole runtime authority; fail-closed unsupported actions; no tool/settlement dual-write in Phase 1.
- Shared types/crypto/payload allowlist; status omits passHash.
- passHash safeStorage in teaching-settings; connect URL pairing material is intentional protocol (not public DTO field).
- Preload thin bridge; settings opt-in only.
- Settings external relay fields foreshadow Phase 3; no second live transport authority.
- Residual: ADR-0142 MCP settings surface; appStore not settlement writer.

### Negative evidence

- Peel manager message switch now fails (Phase 2 not landed).
- Strip hash from connect URL breaks pairing.
- Channel brand panel is presentation shell, not second control plane.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Shared / main manager / thin IPC / settings peels |
| Interface depth | **Healthy** | Pairing crypto + feature gates + fail-closed actions |
| Seam legitimacy | **Healthy** | Main sole runtime; not settlement dual-write |
| Test surface | **Healthy** | Unit + check:web-remote-control |
| Conceptual integrity | **Healthy** | Matches ADR-0143 Phase 1 |
| Cost proportionality | **Healthy** | Phase 2 is product completion, not arch debt |

### Candidates

**0 candidates**.

**Reopen if:** Control RPC via renderer IPC bypasses lattice; passHash in status/Doctor; default cloud host; Bot Channel real authority without ADR; dual relay+LAN session authority; marketplace half-surface / YOLO.
