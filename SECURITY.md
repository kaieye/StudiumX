# Security Policy

StudiumX is a **local teaching workspace**. This document states the product trust model in plain language; canonical architecture decisions live in [`docs/adr/`](docs/adr/README.md), and executable enforcement lives in security checks.

## Security boundaries

1. **Teaching workspace root** — agent and tool reads/writes must remain inside the opened workspace, pass path containment and reject protected paths or unsafe symlink traversal.
2. **Teaching authority** — workspace files and `LearningSessionLedger` own AI teaching facts; `TeachingTurnCoordinatorHost` remains settlement sole-writer, settlement IPC uses `expectedRevision`, and fork/recovery keeps `toolsReplayed: false` ([ADR-0001](docs/adr/0001-teaching-authority-and-session-ledger.md), [ADR-0002](docs/adr/0002-evidence-gated-outcome-settlement.md)).
3. **Secret storage** — provider keys, OAuth tokens and resolved headers/env remain main-process secrets. Public config, renderer/preload IPC, Doctor, support bundles and logs are secret-free ([ADR-0006](docs/adr/0006-secret-free-configuration.md)).
4. **Provider egress** — model and optional web tools leave the machine only through configured provider endpoints. External content is untrusted and cannot become system/developer instruction merely by being fetched or read.
5. **Logs and support bundles** — diagnostics use allowlisted, redacted metadata; support bundles require explicit user action. There is no default remote telemetry, phone-home or background upload ([ADR-0007](docs/adr/0007-local-observability-and-diagnostics.md)).
6. **Tool authorization** — every tool passes effect classification, capability, workspace trust, approval, path fence and applicable sandbox policy. Unknown tools fail closed as `privileged`; there is no YOLO / always-approve / DangerFullAccess product label ([ADR-0005](docs/adr/0005-tool-effects-approval-and-write-policy.md)).
7. **Workspace shell** — `workspaceShell` defaults on, but `approvalMode` and `sandboxMode` are independent axes. Commands are argv-spawned and cwd-fenced; an unavailable OS helper reports `notConfigured`. StudiumX does not claim Docker/VM-class isolation ([ADR-0015](docs/adr/0015-shell-sandbox-dual-axis.md)).
8. **MCP lifecycle and trust** — MCP tools enter the same effect and approval lattice; remote annotations never downgrade policy. OAuth tokens and resolved server secrets stay main-process only. MCP results are not LearningSession, Evidence or Outcome authority ([ADR-0013](docs/adr/0013-mcp-runtime-trust-and-secrets.md)).
9. **MCP product surface** — Settings ships list/editor/import/OAuth only, with no marketplace settings page. This is a current design non-claim rather than a permanent ban; reopening it requires independent product and security review.
10. **Memory and search** — memory write/delete/injection requires explicit human consent. No SQLite FTS or vector database is exposed as a user product search surface; internal bounded lexical `memory_search` remains allowed ([ADR-0009](docs/adr/0009-consent-gated-memory.md), [ADR-0012](docs/adr/0012-file-authority-projections-and-durable-publish.md)).
11. **Mobile web remote control** — `web-remote-control` remains `under_development` and default off. Default bind is loopback; LAN bind is explicit; there is no default cloud relay. Pairing secrets use secret storage, status DTOs are secret-free, and remote tool actions still require effect/approval. An optional self-hosted WSS URL is user-configured only.

Executable gates: `pnpm run check:security`, `pnpm run check:provider-privacy`, `pnpm run check:settings-secret-storage`, `pnpm run check:web-remote-control`.

## Defense in depth, not boundary claims

The following reduce risk but are not substitutes for the boundaries above:

- model resistance to jailbreaks or over-requested tools;
- prompt-injection handling for learner materials, fetched content or Skill packs;
- interactive approval copy and lesson-scoped grants;
- pathname `temp → write → optional fsync → rename`, which is durable publish rather than descriptor-strict CAS or an OS sandbox.

Bypassing a heuristic is not automatically a vulnerability unless it crosses a declared boundary such as workspace escape, secret leakage, unauthorized egress or settlement-authority bypass.

## Reporting a vulnerability

Report security issues through GitHub Security Advisories for this repository, or a private maintainer channel if Advisories are unavailable. Include:

- affected version or commit;
- impacted boundary (workspace, secrets, egress, redaction, settlement);
- a minimal reproduction without real learner secrets.

Do not open public issues containing API keys, learner answers or unredacted support bundles.

## Related docs

- [ADR index](docs/adr/README.md)
- [Tool contract](docs/tools/TOOL_CONTRACT.md)
- [Settings example](studiumx-settings.example.json)
- [Contributor checks](CONTRIBUTING.md)
