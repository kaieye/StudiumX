# TeachOS

TeachOS is a local teaching workspace context. It turns a learner's goals, trusted resources, lessons, conversations, and review records into durable files that can be moved outside the app.

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
One learning step inside a Course, usually anchored by a Lesson.
_Avoid_: lesson folder, chapter

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
