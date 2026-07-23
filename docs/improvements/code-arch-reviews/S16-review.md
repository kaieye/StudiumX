# Slice S16 — code-arch-improve (read-only)

**Agent:** /root (main-thread)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S16

Renderer residual (excluding study-space S15 + workbench S13–S14): settings/MCP UI, app-shell, App.tsx, pet, agent-conversation presentation, teaching commit client, markdown, resources, workflows.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | **56 files / ~22.7k** residual renderer (one residual pass; over 10k because App/appStore/settings co-located) |
| Examined deeply | `SettingsView` + `UserMcpSettingsSection` / model / list / editor; `appStore` facade; `App.tsx` composition header; `AppPet` + pet-interaction/notifications peels; `learning-outcome-commit-client`; `agent-conversation-state` + runner headers |
| ADRs | **0142** MCP Settings surface = list/editor/import/OAuth only; **0132/0141** MCP parity/experience; sole-writer outcome commit; no YOLO/shell |
| Tests | Settings/MCP model units, outcome-commit units, agent-conversation units, pet notification/interaction checks (scripts + unit) |

**Material evidence**

- **MCP product surface (ADR-0142):** `UserMcpSettingsSection` header documents list + status, add/edit, import, OAuth authorize; **explicitly no marketplace UI**. Public DTOs secret-free (refs / placeholders / `MCP_SECRET_*`); secretChanges separate from public config draft model.
- **Settings composition:** `SettingsView` is section router over peels (ModelProvider, Doctor, TurnReview, UserMcp); primitives shared; not a second settings authority.
- **appStore (~2.2k):** Zustand facade composing contextTransitions, lessonGenerationFlow, agent-conversation-runner, operationFeedback, learning-asset-reader — UI app state, not teaching settlement sole-writer. Domain peels already extracted.
- **App.tsx (~3.0k):** root UI composition (frame, navigator, workbench, settings, pet, markdown, composer). Size is presentation wiring, not missing domain seam.
- **Pet:** interaction / notifications / animation catalog peels; AppPet composes them; local placement storage only.
- **Outcome commit client:** renderer projects sole-writer IPC results; never invents mastery/save facts; stable operationId from evidence sequence; learner-safe status projection.
- **Agent conversation:** pure state transitions + runner adapter; presentation modules separate from main settlement.
- **No YOLO / always-approve / default shell** language in residual renderer product paths (grep-negative).

**Negative evidence**

- Peel-for-size of App.tsx or appStore alone fails ADR-0075 + skill gates without dual thrash around one shallow seam.
- Marketplace absence is intentional policy, not incomplete half-surface that needs “architecture” to finish.
- Secrets stay out of public MCP DTOs at the settings model boundary.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | MCP list/editor/model peels; pet peels; outcome-commit client; conversation state/runner |
| Interface depth | **Healthy** | Settings/MCP use public secret-free DTO + IPC; outcome status projects sole-writer results |
| Seam legitimacy | **Healthy** | ADR-0142 product surface; renderer projection vs main settlement; UI store vs file authority |
| Test surface | **Healthy** | Units + check scripts for MCP/settings/pet/conversation |
| Conceptual integrity | **Healthy** | MCP Settings surface matches ADR-0142 wording in source header |
| Cost proportionality | **Healthy** | 0 candidates |

### Candidates

**0 candidates**

**Reopen if:** marketplace/settings half-surface reappears; secrets leak into public MCP DTO/Doctor UI; appStore becomes a second settlement writer; YOLO/shell labels appear; outcome client invents mastery without sole-writer IPC.

### Metrics for tracker

- approx_lines_examined: **22674**
- files_examined: **56**
- candidate_count: **0**
- status_for_tracker: **good_enough**
