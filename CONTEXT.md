# StudiumX

StudiumX is a local teaching workspace context. It turns a learner's goals, trusted resources, lessons, conversations, and review records into durable files that can be moved outside the app.

## Language

**Teaching workspace**:
A local folder that holds the long-lived assets for one learning effort.
_Avoid_: project, folder, workspace service

**Workspace catalog**:
The app's read-side view of what currently exists inside a Teaching workspace, including learning assets and their visible organization.
_Avoid_: file tree, index, cache

**Mission**:
The learning intent and practical success criteria for a Teaching workspace.
_Avoid_: prompt, brief, task

**Resource**:
A trusted source or material that a Lesson can draw from.
_Avoid_: link, reference

**Course**:
A named grouping of Sessions inside a Teaching workspace.
_Avoid_: folder, category

**Session**:
One learning step inside a Course, usually anchored by a Lesson. Never reuse bare "Session" for pomodoro or timer runs.
_Avoid_: lesson folder, chapter, timer session, pomodoro session

**Lesson**:
A saved, reviewable HTML teaching artifact for one focused learning step.
_Avoid_: page, generated output

**Learning record**:
A durable note that captures what changed in the learner's understanding after a Lesson or conversation.
_Avoid_: log, transcript

**Reference**:
A concise reusable aid produced alongside or after a Lesson.
_Avoid_: resource, note

**Agent conversation**:
A saved exchange with the teaching assistant that may belong to a Course or remain temporary.
_Avoid_: chat log, message history

### Study planning language

Study-space checklist, focus rhythm, and clock facts. Distinct from teaching Course/Session language. Phase 0 decision freeze authority: [ADR-0094](docs/adr/0094-study-task-timer-planning-design-gate.md). Planning/detail roadmap archived/removed; residual policy: [ADR-0130](docs/adr/0130-study-planning-phase7-and-completion-residual.md). Local focus analytics are local study analytics, not remote telemetry.

**Study task**:
A learner checklist intent in study space (something to finish, possibly over several blocks). Not a teaching Mission and not one timer run.
_Avoid_: Mission, task (unqualified when teaching Mission is meant), timer session

**Timer plan**:
A reusable focus/break rhythm (for example 25/5 with long-break rules). Not a calendar day schedule and not a running clock.
_Avoid_: schedule, day plan, timer session

**Time window**:
An available clock range the learner is willing to use for focus, for example 09:00–12:00. Not the rhythm rules of a Timer plan.
_Avoid_: timer plan, schedule block

**Schedule block**:
A confirmed concrete plan slot (for example 09:00–09:25 on task A). Saved arrangement, not yet the lived clock fact.
_Avoid_: allocation proposal, timer session, actual duration

**Allocation proposal**:
Pure allocator output that shows how tasks and breaks fit a Time window before the user confirms. No durable write until confirmed.
_Avoid_: schedule block, saved schedule

**Timer session**:
An actual running, paused, completed, or interrupted clock fact (count-up or countdown). Completing a segment is not completing a Study task.
_Avoid_: Session, LearningSession, timer plan, schedule block
