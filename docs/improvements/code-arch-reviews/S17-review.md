# Slice S17 — code-arch-improve (read-only)

**Agent:** Grok Build / code-arch-improve (S17 HEAD re-confirm)
**Revision:** HEAD `d9435064` (prior 0-cand closeout; light re-review)
**Skill:** `$code-arch-improve` + codebase-design vocabulary
**Mode:** read-only — **0 production edits**

---

### Slice S17

Preload IPC bridge + renderer entry glue.

### Scope

| Item | Value |
| --- | --- |
| Revision | `d9435064` |
| Primary LOC | **3 files / ~277** (`src/preload/index.ts` ~190+, `agent-realtime-delivery.ts` ~74, `src/renderer/src/main.tsx` ~12) |
| Examined | preload `TeachingSystemApi` bridge over `teachingInvokeChannels` / event channels; agent realtime delivery + replay; `main.tsx` StrictMode root |
| ADRs | teaching IPC contract; agent stream delivery; no shell product path |

**Material evidence**

- **Thin contextBridge:** maps typed `TeachingSystemApi` methods to `ipcRenderer.invoke` channels from shared contract — wiring + stream listener lifecycle only; no business policy in preload.
- **Realtime delivery peel:** ordered accept/replay/flush for agent chat events; keeps stream reliability out of the giant API map.
- **Entry:** `main.tsx` only mounts App + CSS under StrictMode — correct shallow shell.

**Negative evidence**

- Expanding preload with domain logic would be a regression, not a missing peel opportunity today.
- No default shell / YOLO surface on the bridge.

### Verdict

**Good enough — no architecture change recommended**

### Fitness

| Criterion | Mark | Evidence |
| --- | --- | --- |
| Change locality | **Healthy** | Channel contract + thin bridge; realtime peel |
| Interface depth | **Healthy** | Renderer sees `TeachingSystemApi` only |
| Seam legitimacy | **Healthy** | Preload is Electron security boundary, not a domain module |
| Test surface | **Healthy** | IPC contract checks live in scripts/units (outside thin glue) |
| Conceptual integrity | **Healthy** | Matches teaching IPC contract language |
| Cost proportionality | **Healthy** | Already minimal |

### Candidates

**0 candidates**

**Reopen if:** preload grows business policy / dual API surfaces; raw ipc channels leak past `TeachingSystemApi`; shell/exec channels appear as product surface.

### Metrics for tracker

- approx_lines_examined: **280**
- files_examined: **3**
- candidate_count: **0**
- status_for_tracker: **good_enough**
- note: HEAD `d9435064` re-confirm; prior 0-cand stands
