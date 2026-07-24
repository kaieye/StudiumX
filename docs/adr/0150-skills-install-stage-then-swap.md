# ADR-0150：Skills 安装 stage-then-swap（LiveAgent Phase B / worth-learning §3.6）

- **状态：** **已实施**（2026-07-24）
- **日期：** 2026-07-24
- **范围：** builtin allowlist 技能包向 personal root **文件系统安装**时，使用 `.staging` 构建 + rename 提升 + 目录 write guard，使读者永不看见半成品技能树。
- **关联：** [liveagent-worth-learning.md](../improvements/liveagent-worth-learning.md) §3.6；[ADR-0131](0131-pathname-default-durable-io.md)；`SECURITY.md`；`Agents.md` 产品地板（无开放 marketplace / 无 Shell / 无 YOLO）
- **实现落点：** `src/main/skill-library/skill-install-stage-swap.ts`；`SkillLibraryService.installSkill`；`skill-pack-resolver` write guard；`tests/unit/skill-install-stage-swap.unit.test.ts`

## 1. 问题

`installSkill` 曾直接 `cp` 到 `personalRoot/<skillId>`。构建中断时，catalog / 引用读取可能看到半成品目录。LiveAgent 用 `.staging` + 原子 rename 避免该窗口。

## 2. 决策

| 项 | 说明 |
| --- | --- |
| **Stage** | 在 `<installRoot>/.staging/<skillId>` 下完整构建 |
| **Verify（可选）** | `verifyStaged` 在 promote 前拒绝坏包；失败清理 staging，不动已有 final |
| **Swap** | `rename` 提升到 `<installRoot>/<skillId>`；Windows 上若 final 已存在则先移到 `.staging/<id>.prev` 再 rename |
| **Write guard** | 解析器忽略 `.staging`、点目录与非 safe skill id；不把 staging 当技能包 |
| **Allowlist / verifier** | **不变**：仅 `BUILTIN_SKILL_IDS`；源包与安装后仍走 `verifySkillPack`；**无**开放 marketplace |
| **Shared resources** | 仍在 final 路径旁的 `_shared` 上 `copyDeclaredSharedResources`；staging 树不解析 `../_shared`（见 residual） |

## 3. Residual

- **Shared 路径校验时机：** 完整 `verifySkillPack`（含 `../_shared/*`）在 **promote + shared copy 之后**对 final 路径执行；源包在 `findBuiltInSkillPack` 时已校验。staging 目录的 sibling 不是 product `_shared`，故不在 staging 上做共享资源存在性校验。
- **已安装短路：** 已有合法 pack/legacy 时仍跳过重拷（与历史行为一致）；**不**做就地覆盖升级的 stage-swap（升级策略仍是「已存在则保留」）。
- **非 FS 安装：** 当前产品安装路径 **就是** filesystem pack extract（builtin → personal）；无「仅 catalog flag」短路；若未来仅 toggle 标记，应复用本 helper 或显式标注非 FS 路径。

## 4. 非目标 / 红线

1. **禁止** 开放无校验 skill marketplace 或任意远程包安装。
2. **禁止** Shell / YOLO / always-approve 安装旁路。
3. **禁止** 把 `.staging` 或半成品目录暴露为 skill catalog / invoked skill 引用。
4. **不** 改变 settlement / teaching evidence 权威。

## 5. 一句话

Skill pack 先在 `.staging` 建完再 rename 进 final 路径；allowlist + pack verifier 仍是唯一信任门。
