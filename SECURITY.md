# Security Policy

StudiumX is a **local teaching workspace**. This document states the product trust model in plain language. Deep engineering boundaries live in ADRs and executable checks.

## Security boundaries (what we treat as product boundaries)

1. **Teaching workspace root** — agent and tools must not escape the opened workspace path containment. Workspace reads/writes are path-gated.
2. **Secret storage** — provider API keys and similar secrets are stored via platform secret storage (`safeStorage` / settings secret path). Resolved config snapshots used for diagnostics must be **secret-free** (see ADR-0025).
3. **Provider egress** — model and optional web tools only leave the machine through configured provider endpoints. Privacy redaction applies to logs and support material where implemented.
4. **Logs and support bundles** — support bundles require explicit user consent and redaction (ADR-0034). History redaction applies to newly persisted conversation/history projections (ADR-0007).
5. **Tool effect authorization** — tools are classified (`read` | `workspace_write` | `external_write` | `privileged`) and fail closed for unknown tools (ADR-0024). Capability catalog remains fail-closed (ADR-0022).

Executable gates: `pnpm run check:security`, `pnpm run check:provider-privacy`, `pnpm run check:settings-secret-storage`.

## Non-boundaries (hardening, not the OS isolation claim)

The following are **defense-in-depth heuristics**, not a claim of OS-level isolation against a fully adversarial model:

- Model attempts to jailbreak or over-request tools
- Skill / prompt-injection text inside learner materials or skill packs
- Interactive approval UI heuristics and session grants

Bypassing a heuristic **does not automatically** constitute a CVE unless it crosses a declared boundary above (workspace escape, secret leakage, unauthorized network egress, settlement authority bypass, etc.).

## Explicit non-claims

- StudiumX currently **does not** expose a general shell / arbitrary code execution product path.
- We **do not** claim Docker-class OS sandbox isolation for model actions.
- LearningSession ledger / outcome settlement authority is **not** owned by the agent controller (ADR-0008, ADR-0021, ADR-0023).

## Reporting a vulnerability

Please report security issues via GitHub Security Advisories for this repository (or a private maintainer channel if Advisories are unavailable). Include:

- Affected version / commit
- Impacted boundary (workspace, secrets, egress, redaction, settlement)
- Minimal reproduction **without** real learner secrets

Do not open public issues that contain API keys, learner answers, or unredacted support bundles.

## Related docs

- ADR index: `docs/adr/README.md`
- Tool contract: `docs/tools/TOOL_CONTRACT.md`
- Config paths: `docs/CONFIG_PATHS.md`
- Contributor checks: `CONTRIBUTING.md`
