# Security Policy

StudiumX is a **local teaching workspace**. This document states the product trust model in plain language. Deep engineering boundaries live in ADRs and executable checks.

## Security boundaries (what we treat as product boundaries)

1. **Teaching workspace root** — agent and tools must not escape the opened workspace path containment. Workspace reads/writes are path-gated.
2. **Secret storage** — provider API keys and similar secrets are stored via platform secret storage (`safeStorage` / settings secret path). Resolved config snapshots used for diagnostics must be **secret-free** (see ADR-0025).
3. **Provider egress** — model and optional web tools only leave the machine through configured provider endpoints. Privacy redaction applies to logs and support material where implemented.
4. **Logs and support bundles** — support bundles require explicit user consent and redaction (ADR-0034). History redaction applies to newly persisted conversation/history projections (ADR-0007).
5. **Tool effect authorization** — tools are classified (`read` | `workspace_write` | `external_write` | `privileged`) and fail closed for unknown tools (ADR-0024). Capability catalog remains fail-closed (ADR-0022).
6. **User-configured MCP (policy; not shipped by this doc alone)** — product policy **allows** users to opt-in and configure **user-specified** MCP servers (ADR-0127 design gate + ADR-0128 implementation contract). **Default remains off** (no auto-connect, no marketplace). MCP tool calls must enter the same effect lattice and interactive approval path; MCP outputs are **not** LearningSession / Evidence / Outcome settlement authority. Users trust the servers they enable; StudiumX does **not** endorse third-party MCP servers as audited. Implementation requires a follow-up implementation ADR and security checks before product paths merge.

Executable gates: `pnpm run check:security`, `pnpm run check:provider-privacy`, `pnpm run check:settings-secret-storage`.

## Non-boundaries (hardening, not the OS isolation claim)

The following are **defense-in-depth heuristics**, not a claim of OS-level isolation against a fully adversarial model:

- Model attempts to jailbreak or over-request tools
- Skill / prompt-injection text inside learner materials or skill packs
- Interactive approval UI heuristics and session grants

Bypassing a heuristic **does not automatically** constitute a CVE unless it crosses a declared boundary above (workspace escape, secret leakage, unauthorized network egress, settlement authority bypass, etc.).

## Explicit non-claims

- StudiumX currently **does not** expose a general shell / arbitrary code execution product path.
- **MCP marketplace** and **default auto-connect** remain non-goals. User-configured MCP is **policy-approved** under ADR-0127 but **not** claimed as implemented until ADR-0128 phases A–D land; when implemented, default remains off and YOLO / always-approve remain forbidden.
- We **do not** claim Docker-class OS sandbox isolation for model actions.
- Windows memory and workspace I/O use an explicit **layered non-CAS** profile (`windows_direct_path_non_cas`: root-constrained direct-path persistence). This is **not** an OS sandbox claim and is **not** descriptor/CAS-equivalent (ADR-0126, ADR-0004 / ADR-0035).
- LearningSession ledger / outcome settlement authority is **not** owned by the agent controller (ADR-0008, ADR-0021, ADR-0023).

## Reporting a vulnerability

Please report security issues via GitHub Security Advisories for this repository (or a private maintainer channel if Advisories are unavailable). Include:

- Affected version / commit
- Impacted boundary (workspace, secrets, egress, redaction, settlement)
- Minimal reproduction **without** real learner secrets

Do not open public issues that contain API keys, learner answers, or unredacted support bundles.

## Related docs

- ADR index: `docs/adr/README.md`
- User-configurable MCP design gate: `docs/adr/0127-user-configurable-mcp-design-gate.md`
- User-configurable MCP implementation contract: `docs/adr/0128-user-configurable-mcp-implementation.md`
- Tool contract: `docs/tools/TOOL_CONTRACT.md`
- Config paths: `docs/CONFIG_PATHS.md`
- Contributor checks: `CONTRIBUTING.md`
