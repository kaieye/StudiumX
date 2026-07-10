# Design Rationale — Why This Skill Architecture

If you're wondering "why is this skill organised the way it is", "should this new feature be a new sub-skill or fit into an existing one", or "the user wants X — does that map to my architecture cleanly", read this.

## Why One Top-Level Skill + 10 Sub-Skills (Not One Mega-Skill, Not 11 Flat)

Considered alternatives:

1. **One mega-skill** (`teaching-site` does everything inline) — rejected because:
   - Single SKILL.md would be > 1500 lines, busting skill-creator's < 500-line recommendation.
   - Every conversation that mentioned "做電子書" would load all 1500 lines into context, even though only ebook content is relevant.

2. **11 flat skills, no entry point** (the original design) — partially worked but:
   - Users with broad requests ("做一套課程網站") got triggered into one specific stage, miss the orchestration.
   - 11 descriptions permanently in `available_skills` is heavier than 1+10 with the top-level as the broad trigger.
   - "What is this set of skills?" had no canonical answer; you had to read 11 SKILL.md to find out.

3. **Current design** (`teaching-site` top + 10 sub-skills) wins because:
   - Top-level handles broad requests with orchestration.
   - Sub-skills remain independently triggerable for narrow requests.
   - Top-level's `references/` provides scaling-without-mega-skill: detailed scenarios / troubleshooting / checklists live in references that are only loaded when needed.

## Why Connect Rules Live in Sub-Skills, Not the Orchestrator

The big "three-place sync" knowledge could go in `teaching-site` orchestrator, but it lives in `course-content-authoring` and `static-spa-conversion`. Reason:

- The rule "every new material needs file + course-data.js entry + router rule" is **triggered by an action** (adding a material). The skill that handles that action (`course-content-authoring`) is where the rule belongs.
- If the rule lived in the orchestrator, every sub-skill invocation would need a "did I follow the orchestrator's rules?" check — that creates fragile coupling.
- This is the **"co-locate rules with the action that triggers them"** principle. Orchestrator only owns rules that span sub-skills (e.g. "verify after every stage").

## Why "Verify vs Audit" Are Two Separate Skills

Tempting to merge them ("they both check things"). Wrong because:

- They have **opposite failure modes** (verify blocks CI on non-zero exit; audit always exits 0 and produces a report for humans).
- They're **invoked at different cadences** (verify on every change; audit at release milestones).
- They have **different intended consumers** (verify is for the CI / pre-deploy gate; audit is for human judgement).

Skills must have a single dominant operating mode. A skill that's "sometimes blocks, sometimes informs" produces unclear behaviour.

## Why `course-corporate-edition` Is Stage 5b Not a Subset of Stage 3

A corporate edition isn't "Stage 3 with different course-data". It's a **fundamentally different artifact**:
- Single-file delivery (inlined COURSE) vs. multi-file (external course-data.js)
- Asset fallback chain (corp → public) vs. single asset folder
- Audience: client IT who unzips and self-hosts vs. learners visiting a URL

If `static-spa-conversion` had a "corporate flag" it would be 30% configuration switches. Separating them keeps both clean.

## Why Ebook Is Stage 6 Not a Sub-Step of Stage 5

The ebook reads `window.COURSE` from the deployed site (web or corporate). It's a **derivative consumer**, not a step in producing the site itself. Stage 5 (visuals) leaves the site **complete**; Stage 6 derives a new artifact from it.

If we'd called the ebook "Stage 5.5", users would assume building the ebook is a normal part of the site pipeline — but it's optional and runs only at release milestones.

## When to Create a New Sub-Skill vs. Extend an Existing One

**Create a new sub-skill** if all three are true:
- It has its own distinct **trigger phrases** that don't overlap existing ones.
- It produces a **distinct artifact** or operates on a distinct concern.
- Its concerns are **not naturally scoped** by an existing stage (e.g. design-system is cross-cutting, so couldn't fit into any single stage).

**Extend an existing sub-skill** otherwise. Common case: a new variant of corporate edition (e.g. corporate-edition with custom case studies). That's a parameter of `course-corporate-edition`, not a new skill.

**Special case: References inside this top-level skill**: If the knowledge is more about "how to orchestrate" than "how to do" the work, add a reference file here instead of a new sub-skill.

## Why the Design System Is Cross-Cutting Not Stage-Specific

Design tokens (colors, typography, components) are referenced by:
- Stage 3 SPA (visual style of every page element)
- Stage 4 interactions (hover states, transitions reference token timings)
- Stage 5 visuals (illustration style consistency)
- Stage 5b corporate edition (must keep the brand)
- Stage 6 ebook (print CSS overrides token surfaces but keeps badge / typography)

A skill referenced by 5 other skills shouldn't live inside any one of them. Cross-cutting placement is right.

## The Domain-Agnostic Principle

Critical: **none of these skills hardcode "AI workshop" content**. The example workshop ("行政與財務 AI 自動化") was the data source, but every skill describes the *shape* of teaching sites, not the *topic* of any specific course.

This means:
- A cooking class could use these skills unchanged.
- An accounting training could use these skills unchanged.
- The user's `content.md` carries all topic-specific knowledge; the skill prompts carry only structural knowledge.

If you find yourself adding "this is about AI workshops" to a sub-skill prompt, refactor — that example belongs in the user's content.

## The Bilingual Trigger Strategy

Every sub-skill's description has both Chinese and English trigger phrases. Reason: skill matching across most agents (Claude Code, Codex, Antigravity, etc.) is keyword-based against the description; users will type whichever language they're comfortable in. Halving the phrase list to one language halves the recall rate.

Format: "Triggers on phrases like `\"中文\"`, `\"中文 2\"`, `\"english\"`, `\"english 2\"`."

## When the Architecture Breaks

These signs suggest the skill set needs revision (not just patching):

- **A request consistently fails to dispatch correctly** — the top-level skill's detection rules need clarification, or a new sub-skill is needed.
- **Two sub-skills constantly need to be invoked together** — they should probably merge, or one should reference the other in its description.
- **A user concept doesn't fit any sub-skill** — either it's outside the domain, or you need a new sub-skill.
- **A sub-skill's SKILL.md exceeds 600 lines** — split it (create variants or use `references/` like this top-level skill does).

The architecture is meant to be revised. Skills are not contracts; they're living documents. When they fail to serve, change them.
