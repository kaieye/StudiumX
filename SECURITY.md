# Security Policy

StudiumX is a **local teaching workspace**. This document states the product trust model in plain language. Deep engineering boundaries live in ADRs and executable checks.

## Security boundaries (what we treat as product boundaries)

1. **Teaching workspace root** — agent and tools must not escape the opened workspace path containment. Workspace reads/writes are path-gated.
2. **Secret storage** — provider API keys and similar secrets are stored via platform secret storage (`safeStorage` / settings secret path). Resolved config snapshots used for diagnostics must be **secret-free** (see ADR-0025).
3. **Provider egress** — model and optional web tools only leave the machine through configured provider endpoints. Privacy redaction applies to logs and support material where implemented.
4. **Logs and support bundles** — support bundles require explicit user consent and redaction (ADR-0034). History redaction applies to newly persisted conversation/history projections (ADR-0007).
5. **Tool effect authorization** — tools are classified (`read` | `workspace_write` | `external_write` | `privileged`) and fail closed for unknown tools (ADR-0024). Capability catalog remains fail-closed (ADR-0022).
6. **MCP lifecycle and trust** — ADR-0132 + ADR-0141 (hard safety / foundation) + **ADR-0142 (Settings product surface)**: multi-source, auto-connect host APIs, OAuth, workspace-root injection, and plugin MCP remain available. **Marketplace is main/shared foundation only** — **no Settings marketplace UI** in current shipping. MCP Settings = list/editor/import/OAuth. Hard invariants unchanged: secrets/tokens never enter renderer/Doctor/support bundle/logs; MCP results are not LearningSession/Evidence/Outcome authority; settlement sole-writer unchanged; tool calls still pass effect lattice + approval (no YOLO). Catalog fetch is not product telemetry. Emergency disable / revoke remain required.

Executable gates: `pnpm run check:security`, `pnpm run check:provider-privacy`, `pnpm run check:settings-secret-storage`.

## Non-boundaries (hardening, not the OS isolation claim)

The following are **defense-in-depth heuristics**, not a claim of OS-level isolation against a fully adversarial model:

- Model attempts to jailbreak or over-request tools
- Skill / prompt-injection text inside learner materials or skill packs
- Interactive approval UI heuristics and session grants

Bypassing a heuristic **does not automatically** constitute a CVE unless it crosses a declared boundary above (workspace escape, secret leakage, unauthorized network egress, settlement authority bypass, etc.).

## Explicit non-claims

- StudiumX currently **does not** expose a general shell / arbitrary code execution product path.
- **MCP multi-source / auto-connect / workspace-root / plugin foundation** are authorized under ADR-0132 + ADR-0141; **Settings marketplace UI is out of shipping surface** (ADR-0142) (parity with mainstream MCP clients). Prefer clear toggles and revoke/emergency paths over permanent feature bans. Auto-connect discovers tools; tool invocation still uses effect/approval. YOLO / always-approve labels remain forbidden.
- We **do not** claim Docker-class OS sandbox isolation for model actions.
- Memory and workspace durable I/O default to **trusted-root pathname** persistence (`temp → write → optional fsync → rename`; ADR-0131). This is **non-CAS**, **not** descriptor-strict, and **not** an OS sandbox claim. Historical dual-profile inventory (ADR-0126) remains documentation only; descriptor-strict is **not** the full-platform default (see also ADR-0004 / ADR-0035).
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
- MCP Zcode parity / trust lifecycle (phased): `docs/adr/0132-mcp-zcode-parity-and-trust-lifecycle.md`
- MCP Phase A runtime reliability: `docs/adr/0133-mcp-runtime-reliability-implementation.md`
- MCP Phase B result safety / artifacts: `docs/adr/0134-mcp-result-safety-and-local-artifacts.md`
- MCP Phase C OAuth PKCE / token lifecycle: `docs/adr/0135-mcp-oauth-pkce-and-secret-token-lifecycle.md`
- MCP Phase D config import/export / McpSync wire: `docs/adr/0136-mcp-config-import-export-and-sync-contract.md`
- MCP Phase E multi-source / auto-connect: `docs/adr/0137-mcp-multi-source-precedence-and-auto-connect.md`
- MCP Phase F workspace-root injection: `docs/adr/0138-mcp-filesystem-workspace-root-injection.md`
- MCP Phase H local marketplace catalog (foundation): `docs/adr/0140-mcp-marketplace-local-catalog.md`
- MCP Settings product surface (no marketplace UI): `docs/adr/0142-mcp-product-surface-settings-only.md`
- Tool contract: `docs/tools/TOOL_CONTRACT.md`
- Config paths: `docs/CONFIG_PATHS.md`
- Contributor checks: `CONTRIBUTING.md`
