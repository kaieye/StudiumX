# Slice S17 — code-arch-improve (read-only)

**Agent:** /root (main-thread)
**Revision:** `6ff53d849b8df3b194ff74bf80f49622bc3aec62`
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S17

Preload IPC bridge + renderer entry glue.

### Scope

| Item | Value |
| --- | --- |
| Revision | `6ff53d849b8df3b194ff74bf80f49622bc3aec62` |
| Primary LOC | **3 files / ~277** (`src/preload/index.ts` ~190, `agent-realtime-delivery.ts` ~74, `main.tsx` ~13) |
| Examined | preload `TeachingSystemApi` bridge over `teachingInvokeChannels` / event channels; agent realtime delivery + replay; `main.tsx` StrictMode root |
| ADRs | teaching IPC contract; agent stream delivery; no shell product path |

**Material evidence**

- **Thin contextBridge:** maps typed `TeachingSystemApi` methods to invoke channels from shared contract — no business policy in preload beyond wiring + stream listener lifecycle.
- **Realtime delivery peel:** ordered accept/replay/flush for agent chat events; keeps stream reliability out of the giant API map.
- **Entry:** `main.tsx` only mounts App + CSS — correct shallow shell.

**Negative evidence**

- Expanding preload with domain logic would be a regression, not a missing peel opportunity today.
- No default shell / YOLO surface.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Channel contract + thin bridge; realtime peel |
| Interface depth | **Healthy** | Renderer sees TeachingSystemApi only |
| Seam legitimacy | **Healthy** | Preload is the Electron security boundary, not a domain module |
| Cost proportionality | **Healthy** | Already minimal |

### Candidates

**0 candidates**

**Reopen if:** preload grows business policy / dual API surfaces; raw ipc channels leak past TeachingSystemApi; shell/exec channels appear.

### Metrics for tracker

- approx_lines_examined: **277**
- files_examined: **3**
- candidate_count: **0**
- status_for_tracker: **good_enough**
