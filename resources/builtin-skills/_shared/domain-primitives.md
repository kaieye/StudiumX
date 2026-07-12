# StudiumX Teaching Site Domain Primitives

This file is the schema authority for built-in teaching-site skills. Keep course-specific examples in the user's workspace; this file only defines stable field names, IDs, and cross-file consistency rules.

## 0. Canonical Project Paths

Generated project paths are English-first so every built-in skill reads and writes the same layout:

| Canonical path | Legacy name to migrate from |
|---|---|
| `course-package/` | `完整課程包/` |
| `overview.md` | `課程總覽.md` |
| `day{n}/outline.md` | `第{n}天/課程大綱.md` |
| `day{n}/content.md` | `第{n}天/教學內容.md` |
| `materials/` | `教學素材/` |
| `shared-scenario.md` | `共用情境.md` |
| `assets/illustrations/` | `assets/插圖/` |
| `corporate-editions/` | `企業版/` |

Do not create both canonical and legacy paths. When adopting an existing project, migrate references atomically or keep reading the existing layout until the user authorizes a rename.

## 1. Course

`window.COURSE` is the deployed site data object.

Required fields:

- `title`: course title.
- `subtitle`: short audience-facing promise.
- `audience`: target learner profile.
- `days`: ordered `Day[]`.

Common optional fields:

- `version`: source/content version.
- `goals`: high-level learning goals.
- `materials`: course-level `Material[]`.
- `preTest`: diagnostic `QuizItem[]`.
- `postTest`: final `QuizItem[]`.
- `resources`: curated `Material[]`.

## 2. Day

A `Day` groups units delivered in one workshop day or equivalent module.

Required fields:

- `id`: stable kebab-case ID, for example `day-1`.
- `title`: visible title.
- `theme`: short instructional theme.
- `units`: ordered `Unit[]`.

Optional fields:

- `duration`: human-readable duration.
- `goals`: day-level goals.
- `summary`: short learner-facing recap.

## 3. Unit

A `Unit` is the smallest navigable teaching section.

Required fields:

- `id`: stable kebab-case ID unique across the course.
- `title`: visible section title.
- `concepts`: `Concept[]`.
- `tasks`: `Task[]`.

Optional fields:

- `duration`: human-readable duration.
- `goal`: unit learning goal.
- `scenario`: running case context.
- `materials`: `Material[]`.
- `quiz`: `QuizItem[]`.
- `faq`: `FaqItem[]`.
- `illustrations`: `Illustration[]`.

Default learner-facing render order is concepts, materials, prompts/examples, tasks, quiz, FAQ, then illustrations placed beside the content they support. A project may choose another order, but its renderer and content authoring guidance must agree.

## 4. Concept

A `Concept` explains one idea.

Required fields:

- `id`: stable kebab-case ID unique within the unit.
- `title`: concise concept name.
- `body`: explanation text or HTML-safe markdown source.

Optional fields:

- `example`: concrete example.
- `whyItMatters`: practical relevance.
- `commonMistakes`: `string[]`.

## 5. Prompt

A `Prompt` is a reusable instruction or discussion starter.

Required fields:

- `id`: stable kebab-case ID.
- `title`: visible label.
- `text`: prompt body.

Optional fields:

- `context`: when to use it.
- `expectedOutput`: output shape learners should aim for.

## 6. Material

A `Material` points to a resource learners may open or download.

Required fields:

- `id`: stable kebab-case ID.
- `title`: visible title.
- `kind`: `link`, `download`, `reading`, `video`, `dataset`, or `tool`.

Optional fields:

- `url`: external URL.
- `path`: local/deployed relative path.
- `description`: short explanation.
- `source`: source attribution.

Use either `url` or `path` for navigable materials. Do not invent both when only one target exists.

## 7. FaqItem

Required fields:

- `question`: learner question.
- `answer`: concise answer.

Optional fields:

- `tags`: grouping hints.

## 8. Task

A `Task` is an action learners perform.

Required fields:

- `id`: stable kebab-case ID unique across the course.
- `title`: visible task title.
- `instructions`: learner-facing steps.

Optional fields:

- `duration`: estimated time.
- `successCriteria`: `string[]`.
- `materials`: `Material[]`.
- `prompt`: `Prompt`.
- `localStorageKey`: explicit progress key.

Progress storage rule:

- Default progress key is `studiumx:task:${task.id}`.
- Never renumber task IDs just to change display order.
- If a task is split, keep the old ID for the closest successor and create a new ID for the new task.

## 9. Activity

Use `Task` for persisted learner actions. Use `Activity` only as a non-persisted classroom facilitation block.

Required fields:

- `title`: visible title.
- `instructions`: facilitation notes.

Optional fields:

- `duration`: estimated time.
- `grouping`: individual, pair, or group.

## 10. QuizItem

Required fields:

- `id`: stable kebab-case ID unique across the course.
- `question`: learner-facing question.
- `options`: ordered option labels.
- `answer`: exact option label or zero-based index.

Optional fields:

- `explanation`: shown after answer.
- `tags`: concept IDs or topic labels.

Storage rule:

- Default selection key is `studiumx:quiz:${quiz.id}`.
- Do not infer quiz count from hard-coded UI text; render from data length.
- Pre-test and post-test items are assessment data, not ebook body content unless explicitly requested.

## 11. Illustration

Required fields:

- `name`: stable asset name or conceptual name.
- `kind`: `image`, `diagram`, `screenshot`, `map`, `qr`, `icon`, or `waived`.
- `alt`: accessible alt text.

Optional fields:

- `path`: generated or scraped asset path.
- `spec`: generation or capture spec.
- `source`: source URL or attribution.
- `reason`: required when `kind` is `waived`.

Coverage floor:

- Every content-heavy unit should have at least one `illustrations[]` item.
- If an illustration is intentionally skipped, add `{ kind: 'waived', reason }` instead of leaving silent absence.

## 12. Asset

An `Asset` is any generated or copied file referenced by the course.

Required fields:

- `path`: deployed relative path.
- `kind`: asset category.

Optional fields:

- `source`: origin URL, prompt, or source file.
- `license`: if known.
- `alt`: required for visual learner-facing assets.

## 13. Cross-File Consistency

Materials, tasks, quiz items, and illustrations often appear in three places:

- source markdown or planning documents;
- `course-data.js` / `window.COURSE`;
- rendered SPA components or generated assets.

Consistency rules:

- Do not update only one place when an ID, title, material URL, or asset path changes.
- Task IDs are stable storage keys; changing IDs loses progress.
- Quiz numbering is display-only; data IDs remain stable.
- Asset files must exist at the relative paths referenced by `window.COURSE`.
- Generated cards, PDFs, and corporate editions should preserve the original course IDs unless the derivative is intentionally forked.

Audit scripts should report drift as review findings, not silently rewrite learner-facing content.
