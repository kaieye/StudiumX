# ADR-0054：Actions SHA pin + dependabot(actions) + OSV fail-open

- **决策状态：** accepted
- **实施状态：** complete
- **日期：** 2026-07-21
- **范围：** GitHub Actions 外部 `uses:` 的 commit SHA 钉死、Dependabot 仅 `github-actions` 生态、OSV 依赖扫描 **fail-open** 可见报告；以及 **allowlist 式 critical npm exact pin**（`better-sqlite3` 等，可选 `check:pinned-critical-deps`，不进 Blocking CI）
- **取代：** 无
- **被取代：** 无
- **相关：** [ADR-0023](0023-teaching-turn-coordinator-host-and-blocking-ci.md)、[ADR-0045](0045-context-hygiene-ladder-and-quality-gates.md)、[ADR-0121](0121-improvements-adoption-closeout.md) **A-09**
- **证据：** `.github/workflows/blocking-ci.yml`、`.github/workflows/contained-durable-replace-linux.yml`、`.github/workflows/main-release-audit.yml`、`.github/workflows/release_dispatch.yml`（SHA 钉死）、`.github/workflows/osv-scan.yml`（fail-open）、`.github/dependabot.yml`（仅 github-actions）、`scripts/check-pinned-critical-deps.mjs`

## 背景

Hermes 工程纪律要求外部 Actions 使用 **full commit SHA**（标签可被移动）、Dependabot 只跟 actions（避免无准备的 npm 洪水 PR），以及 OSV 扫描以 **fail-open** 方式可见——不得用泛型漏洞门替换教学/隐私/安全领域门禁（ADOPTION §5.8、ADR-0023）。

点验基线（实施前）：

- 4 个 workflow 共 14 处外部 `uses:` 均为浮动 `@v4`
- 无 `.github/dependabot.yml`
- 无 OSV / 供应链扫描 workflow

## 决定

### 1. 外部 Actions 钉 SHA

所有 `.github/workflows/*.yml` 中的外部 `uses:` 使用 **40 字符 commit SHA**，并在行尾注释版本标签，例如：

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
```

当前钉死映射（解析自对应 tag 的 tip commit）：

| Action | Tag | Full SHA |
| --- | --- | --- |
| `actions/checkout` | v4.4.0（原 `@v4`） | `11d5960a326750d5838078e36cf38b85af677262` |
| `actions/setup-node` | v4.4.0（原 `@v4`） | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
| `actions/upload-artifact` | v4.6.2（原 `@v4`） | `ea165f8d65b6e75b540449e92b4886f43607fa02` |
| `google/osv-scanner-action/osv-scanner-action` | v2.3.8 | `9a498708959aeaef5ef730655706c5a1df1edbc2` |

后续 Dependabot（github-actions）可打开 PR 更新这些 SHA；合并前应保留 `# vX.Y.Z` 注释。

### 2. Dependabot：仅 github-actions

`.github/dependabot.yml` 仅配置：

- `package-ecosystem: github-actions`
- `schedule.interval: weekly`

**不** 默认开启 npm / pnpm Dependabot（除非未来独立 ADR 批准并说明 PR 噪音与 triage 策略）。

### 3. OSV 扫描：fail-open、非 merge gate

新增 `.github/workflows/osv-scan.yml`：

- 触发：`push`（main）、`pull_request`、每周 schedule、`workflow_dispatch`
- 使用官方 `google/osv-scanner-action/osv-scanner-action`（SHA 钉死）
- 扫描仓库（含 `pnpm-lock.yaml` 等 lockfile）
- 输出 JSON artifact + 表格式日志
- **job 与关键 step 均 `continue-on-error: true`**（fail-open）
- 不调用 `fail-on-vuln` 阻塞路径；不加入 required checks
- **明确不** 修改 `blocking-ci.yml` 的 typecheck / security-privacy / teaching-evidence-p0 门

### 4. Critical npm exact pin（allowlist，ADAPT-P2）

Selective supply-chain hardening for **native / security-sensitive** direct dependencies only——不做全仓 exact pin、不引入 npm-shrinkwrap 双锁 SoT、不开启 npm Dependabot 洪水：

1. **Allowlist**（非全部 UI 依赖）：`better-sqlite3`（native binding；Electron/Node ABI rebuild 敏感）与 `@types/better-sqlite3`。
2. **Exact versions in `package.json`** 仅限 allowlist 名称：`"better-sqlite3": "12.11.1"`、`"@types/better-sqlite3": "7.6.13"`（无 `^`）；bump 须 PR 说明 native 版本 / rebuild 理由。
3. **可选 checker**（同 `check:module-size` 一类，非 Blocking CI）：`scripts/check-pinned-critical-deps.mjs` + `pnpm run check:pinned-critical-deps`；要求 exact pin（无 `^` / `~` / ranges）；有 `pnpm-lock.yaml` 时 importers `specifier` 须匹配且 `packages` 含 `name@version`；违规 exit 非零并打印修复提示；**不进** Blocking CI / teaching gates / required jobs。

详细验证与安装文化边界（`--ignore-scripts` 非 universal，`better-sqlite3` 需 native rebuild scripts）见 [evidence/ADR-0054.md](evidence/ADR-0054.md)。

## 验证

```bash
# 无浮动 major tag 的外部 uses
Select-String -Path .github/workflows/*.yml -Pattern 'uses:\s+[^@\s]+@v[0-9]'
# 期望：无匹配（或仅注释）

# 所有 uses 带 40 字符 SHA
Select-String -Path .github/workflows/*.yml -Pattern 'uses:'

# critical npm exact pin 可选检查
pnpm run check:pinned-critical-deps
```

## 后果

- 供应链基线：Actions 不可变引用 + 周更 Dependabot PR + 可见 OSV 报告。
- Blocking CI 仍窄而硬；教学产品的 merge gate 不被漏洞扫描噪声绑架。

## 非目标

- **不** 用 OSV 或 Dependabot 替换 teaching / privacy / security blocking 门（ADR-0023）。
- **不** 开启 npm Dependabot 或自动合并。
- **不** 默认上传 SARIF 到 GitHub Code Scanning（避免 security-events 权限与私有仓库摩擦；JSON artifact 足够 fail-open 可见）。
- **不** 保证 OSV 覆盖所有传递依赖或零误报；结果是供应链信号，不是发布 blocker。
- **不** 用 critical npm exact-pin check 替换 check:security / teaching gates；**不** 全仓 exact-pin UI 依赖。
- **不** 引入 npm-shrinkwrap 作为第二 lockfile SoT；`pnpm-lock` 仍是唯一锁文件。
- **不** exact-pin electron / 全部 UI 依赖；**不** 改变 Actions pin / Dependabot(actions) / OSV fail-open（§1–3）。
