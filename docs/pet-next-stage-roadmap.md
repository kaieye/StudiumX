# Pet 后续功能候选路线

> 状态：待取舍  
> 适用分支：`pet`  
> 文档目的：集中记录 Pet 当前基线之后仍可实施的功能，供优先级、范围和实现顺序取舍。  
> 执行约定：用户确认范围后再开发；每完成一个可独立验收的部分，单独提交并推送到 GitHub。

---

## 0. 如何使用这份文档

候选项使用以下状态：

- `[ ]` 候选：尚未决定。
- `[x]` 已选择：进入后续实施计划。
- `[-]` 暂缓：保留设计，但当前不实施。
- `[!]` 放弃：明确不实施。

优先级含义：

- **P0**：建议下一步优先实施，能验证关键领域模型或规避主要产品风险。
- **P1**：有明确用户价值，适合在 P0 稳定后实施。
- **P2**：体验增强或基础设施补强，不阻塞核心产品路径。

建议取舍时同时决定：

1. 是否实施该候选。
2. 只做“最小垂直切片”，还是完成全部扩展项。
3. 是否接受候选中列出的产品默认值。
4. 浏览器级测试是否与功能同批完成。

---

## 1. 已完成基线

以下能力已经完成，不再列为待开发范围。

### 1.1 Pet Assistant Dialog 产品化与可访问性

- Dialog、输入框、按钮、状态、Todo 导入和 suggestions 已完整支持中英文。
- pending run、已保存 conversation 和显示 turns 已统一投影。
- cancel、失败、workspace 切换和新建对话不会继续显示旧会话残留。
- 流式 token 不再触发整个消息线程的重复播报。
- ask、tool permission、完成、失败和取消使用独立状态播报。
- interruption、Escape、IME `keyCode 229`、`Shift+Enter` 和焦点恢复已有覆盖。
- 小 viewport、损坏 geometry、安全恢复和 Assistant 窗口重置已实现。
- 已增加独立组件测试、纯模型测试和结构检查脚本。

### 1.2 通知偏好与临时安静模式

- 支持仅显示需要操作的通知。
- 支持 running、短暂 review、waving 的显示开关。
- 支持 Agent、课程生成、Onboarding 来源开关。
- 支持 30 分钟和 1 小时临时安静模式。
- waiting 和 failed 保持可发现，不会被普通低优先级设置完全隐藏。
- 安静模式不改变真实业务 run 生命周期。
- 安静模式结束后不会批量重播已过期的 review 或 waving。
- 通知可见性由纯领域投影决定，不在 JSX 中拼接规则。
- 已增加通知架构检查脚本和单元测试。

---

## 2. 候选总览与初步建议

| 选择 | 候选 | 建议优先级 | 预计工作量 | 主要风险 | 核心依赖 | 初步建议 |
|---|---|---:|---:|---:|---|---|
| [ ] | A. 真实待复习 Lesson 通知 | P0 | 中 | 中 | Lesson/Review 真实数据与生命周期 | **推荐先做一个垂直切片** |
| [ ] | B. 真实 Todo 今日任务提醒 | P1 | 中 | 中 | Todo identity、日期和完成状态 | A 后再决定是否扩展 |
| [ ] | C. Workspace 长时间无进展提示 | P2 | 中高 | 高 | “真实进展”的领域定义 | 建议暂缓 |
| [ ] | D. Pet Library 可访问性与重置 | P1 | 中 | 低 | 现有 appearance/geometry 设置 | 可拆成多个独立部分 |
| [ ] | E. Sprite manifest 与 atlas 构建期校验 | P1 | 小中 | 低 | Pet asset loader 和检查脚本 | 推荐与 D 分开提交 |
| [ ] | F. 真实浏览器布局与无障碍回归 | P1 | 中 | 低中 | Playwright 或 Electron E2E | 只保留 5–8 个高价值场景 |
| [ ] | G. 通知偏好后续增强 | P2 | 小中 | 低 | 已完成的通知策略模型 | 可选，不阻塞真实提醒 |
| [ ] | H. Assistant Dialog 后续非阻塞增强 | P2 | 小中 | 低中 | 已完成的 Dialog 基线 | 按真实反馈实施 |

### 2.1 推荐默认顺序

如果没有新的产品约束，建议按以下顺序取舍：

```text
A. 真实待复习 Lesson 通知（最小垂直切片）
  → E. Sprite 构建期校验 或 D. Pet Library 小切片
  → F. 5–8 个真实浏览器回归
  → B. Todo 今日提醒
  → G/H 的低优先级增强
  → 最后再评估 C. 无进展提示
```

理由：A 能最早验证“真实学习数据 → 稳定通知 identity → 可执行目标 → 生命周期”的完整领域链；C 的误报风险最高，不适合在“进展”尚未形成明确领域定义前实施。

---

## 3. 候选 A：真实待复习 Lesson 通知

### [ ] A. 实施真实待复习 Lesson 通知

- **状态：** 候选
- **建议优先级：** P0
- **用户价值：** Pet 能基于真实学习记录提醒用户继续复习，而不是只反映 Agent 运行状态。
- **真实数据来源：** 已保存的 Lesson、Review、quiz/flashcard progress 或现有 review 投影；最终来源需在实施前确认。

### 3.1 最小垂直切片

只实现一种真实、可解释的提醒：

1. 从已存在的 Review/Lesson 数据中识别一个“待复习 Lesson”。
2. 生成具有稳定业务 ID 的 Pet notification。
3. notification 保存真实 Lesson 目标 ID 或相对路径。
4. 显示明确来源，例如 `lesson-review`。
5. 提供“打开待复习课程”或“开始复习”操作。
6. 当目标不再待复习、被删除或过期时自动移除。
7. dismissal 有明确作用域，不依赖展示文本。
8. 遵守通知来源设置和安静模式，但不影响真实 Review 数据。

### 3.2 必须满足的领域约束

- 只能读取真实 Lesson/Review 数据。
- 每条通知必须具有稳定业务 ID。
- 必须引用真实目标 Lesson ID 或可验证路径。
- 必须声明来源、创建条件、更新条件、过期条件和 dismiss 规则。
- 点击操作必须能到达真实 Lesson/Review 界面。
- 不从错误消息文本推断 review 状态。
- 不创建 Cloud Task 或后台占位通知。
- 不用通知文案、时间戳拼接或随机值作为 identity。
- 通知投影失败不能修改 canonical Lesson/Review 数据。

### 3.3 待决策

- [ ] “待复习”由什么条件定义？
  - Review 到期时间；
  - quiz/flashcard 表现；
  - Lesson 元数据；
  - 或上述规则的明确组合。
- [ ] Review 记录与 Lesson 元数据冲突时，哪个是权威来源？
- [ ] 多个 Lesson 同时待复习时逐条展示还是聚合展示？
- [ ] 通知多久过期？
- [ ] dismiss 表示仅本次、当天，还是直到 Review 数据发生变化？
- [ ] 用户关闭普通来源通知时，待复习提醒是否完全隐藏？
- [ ] 是否在 Activity Stack 中展示到期时间或待复习原因？
- [ ] 目标 Lesson 被移动或删除时如何修复/移除通知？

### 3.4 暂不包含

- 后台定时器或操作系统级计划任务。
- 云端推送。
- 多种学习提醒一次性全部接入。
- 模型根据自由文本推测用户需要复习什么。
- “智能推荐下一课程”的开放式生成。

### 3.5 验收标准

- [ ] fixture 中的真实待复习 Lesson 能稳定生成通知。
- [ ] 相同领域事实重复投影不会产生重复通知。
- [ ] Review 数据变化后，通知能更新或消失。
- [ ] 多 workspace 切换时不残留旧 workspace 通知。
- [ ] 点击操作只打开对应的真实 Lesson/Review。
- [ ] dismiss 行为符合选定作用域并可测试。
- [ ] 安静模式只影响展示，不影响 Review 生命周期。
- [ ] waiting/failed 等高优先级运行状态仍保持可发现。
- [ ] 中英文文案完整。
- [ ] 领域规则由纯函数或独立模块投影，不散落在 JSX。

### 3.6 建议提交拆分

1. `feat(pet): model lesson review notifications`
2. `feat(pet): surface due lesson review actions`
3. `test(pet): cover lesson review notification lifecycle`

每个提交通过对应测试后立即推送。

---

## 4. 候选 B：基于真实 Todo 的今日未完成任务提醒

### [ ] B. 实施真实 Todo 今日提醒

- **状态：** 候选
- **建议优先级：** P1
- **用户价值：** Pet 可以提醒用户今天真实存在且尚未完成的学习任务，并直接进入今日清单。
- **真实数据来源：** 当前 workspace 中的 canonical Todo 数据。

### 4.1 最小垂直切片

1. 只读取今天仍未完成的真实 Todo。
2. 使用稳定 Todo ID 或稳定聚合 identity 生成通知。
3. 提供“打开 Todo”或“打开今日清单”操作。
4. Todo 完成、删除、移出今天或 workspace 切换后，通知同步更新或消失。
5. 不引入虚构调度器和后台执行状态。

### 4.2 待决策

- [ ] 每个 Todo 一条通知，还是一条“今日还有 N 项”的聚合通知？
- [ ] 提醒何时出现：启动时、首次空闲时、固定本地时间，还是用户主动打开 Pet 时？
- [ ] 是否仅在逾期、高优先级或带截止日期时提醒？
- [ ] 功能默认开启，还是必须用户显式开启？
- [ ] 跨日时如何更新 notification identity？
- [ ] Todo 内容修改但 ID 不变时，通知是原地更新还是重新创建？
- [ ] dismiss 是本次、当天还是直到 Todo 状态变化？
- [ ] 多 workspace 是否分别维护 dismiss 状态？

### 4.3 主要风险

- 普通未完成 Todo 数量较多时造成 Activity Stack 噪声。
- 把“今天创建”与“今天到期”混为一谈。
- 用日期拼接 identity 导致跨日重复或旧通知残留。
- 过度提醒使 Pet 从学习搭档变成任务告警器。

### 4.4 验收标准

- [ ] 只为真实存在且符合规则的 Todo 生成提醒。
- [ ] Todo 完成、删除、日期变化后通知正确更新。
- [ ] 相同 Todo 不重复生成多条通知。
- [ ] 聚合模式下数量和目标操作准确。
- [ ] 点击能打开真实 Todo 或今日清单。
- [ ] 中英文文案完整。
- [ ] workspace 切换和应用重启后无跨 workspace 残留。
- [ ] 安静模式不更改 Todo 自身状态。

### 4.5 建议提交拆分

1. `feat(pet): model today todo notifications`
2. `feat(pet): connect todo notification actions`
3. `test(pet): cover todo notification lifecycle`

---

## 5. 候选 C：Workspace 长时间无进展提示

### [ ] C. 实施可选的无进展提示

- **状态：** 候选，建议暂缓
- **建议优先级：** P2
- **用户价值：** 在用户明确需要时，Pet 可以温和提示继续学习。
- **风险等级：** 高。最容易把“暂时没有操作”误判为“学习停滞”。

### 5.1 实施前置条件

只有在“真实进展”形成明确、可测试的领域定义后才实施。不能只使用最后一次鼠标、键盘、窗口聚焦或 Agent run 时间作为学习进展。

### 5.2 可考虑的真实进展信号

- Lesson 完成或更新。
- Review/quiz/flashcard 提交。
- Todo 完成。
- Learning record 写入。
- 明确的学习互动事件。

上述信号不能未经决策直接混合为一个模糊时间戳。

### 5.3 待决策

- [ ] 哪些事件计为“进展”？
- [ ] 阈值是按小时、天还是学习 Session 计算？
- [ ] 是否只在应用前台且用户可见时判断？
- [ ] 是否跨应用重启保存？
- [ ] 功能是否默认关闭？建议默认关闭或通过 onboarding 明确选择。
- [ ] 一次提示被 dismiss 后多久可再次出现？
- [ ] 用户正在阅读但未产生写操作时如何避免误报？
- [ ] workspace 没有 Lesson/Todo/Review 时是否完全不提示？

### 5.4 验收标准

- [ ] 功能可完全关闭。
- [ ] 默认行为已被产品明确确认。
- [ ] 只使用已批准的真实进展信号。
- [ ] 应用后台、系统休眠和跨时区不会造成突然重复提醒。
- [ ] 阅读中的用户不会仅因没有点击而被判定停滞。
- [ ] 提示 identity、冷却时间和 dismiss 规则稳定可测试。
- [ ] 不依赖错误消息文本或随机 ID。

### 5.5 建议提交拆分

1. `feat(pet): model workspace learning progress signals`
2. `feat(pet): add optional inactivity reminders`
3. `test(pet): cover inactivity reminder cooldowns`

---

## 6. 候选 D：Pet Library 体验完善

### [ ] D1. 完善预览区键盘操作

- **建议优先级：** P1
- appearance 列表、预览切换、选择和确认均可只用键盘完成。
- 焦点样式清晰，不依赖颜色作为唯一状态。
- 切换预览不会把焦点移动到被卸载元素。
- Reduced Motion 下不强制播放大幅动画。

### [ ] D2. 增加 appearance 可访问描述与兼容性说明

- 每个 appearance 提供可本地化名称和描述。
- 明确是否支持注视方向、waving、review、drag 等动画。
- Reduced Motion 模式显示显式提示，而不是静默改变预览。
- 不把文件名或内部 manifest key 直接当作用户文案。

### [ ] D3. 增加恢复默认设置

可恢复的项目：

- appearance；
- Pet 名称；
- Pet 尺寸；
- Pet 位置；
- Assistant Dialog 位置和尺寸。

待决策：

- [ ] “恢复全部默认”是否为单一危险操作？
- [ ] 是否同时提供分项重置？建议分项重置，并额外提供带确认的全部重置。
- [ ] Pet 位置与 Assistant 位置是否始终独立重置？建议独立。
- [ ] 重置是否保留通知偏好和安静模式？建议保留，除非选择“重置全部 Pet 设置”。

### [ ] D4. 为键盘用户提供 Pet 移动入口

可选方案：

- 方向键按固定步长移动；
- 设置菜单提供“左上/右上/左下/右下/居中”位置预设；
- 菜单命令进入“键盘移动模式”。

待决策：

- [ ] 采用方向键、位置预设还是两者结合？
- [ ] 多显示器下位置预设作用于当前显示器还是主显示器？
- [ ] 是否需要播报当前位置或边界状态？

### [ ] D5. appearance 切换失败时保留旧外观

- 新 sprite 完整加载并校验成功后再替换当前 appearance。
- 加载失败时保留最后一个有效 appearance。
- 显示可本地化、可恢复的错误反馈。
- 不渲染损坏 sprite、空白 atlas 或尺寸异常资产。

### 6.1 验收标准

- [ ] Pet Library 核心流程可仅用键盘完成。
- [ ] 中英文名称、描述、错误和 Reduced Motion 提示完整。
- [ ] 每种重置操作范围明确且可撤销或需确认。
- [ ] Pet 与 Assistant geometry 可分别重置。
- [ ] 无效 appearance 不替换当前有效外观。
- [ ] appearance 切换失败不会破坏持久化设置。
- [ ] 系统大字号和小窗口下所有操作仍可访问。

### 6.2 建议提交拆分

1. `feat(pet): improve library keyboard navigation`
2. `feat(pet): describe appearance capabilities`
3. `feat(pet): add granular pet reset controls`
4. `fix(pet): preserve appearance on asset failure`
5. `test(pet): cover library accessibility and recovery`

D1–D5 可以独立选择，不要求一次全部实施。

---

## 7. 候选 E：Sprite manifest 与 atlas 构建期校验

### [ ] E. 增加严格的 Pet asset 校验

- **状态：** 候选
- **建议优先级：** P1
- **用户价值：** 在构建或安装阶段尽早拒绝损坏的 Pet，避免运行时显示空白或错行动画。

### 7.1 建议校验内容

- manifest schema 完整且版本受支持。
- appearance ID 稳定、唯一、格式合法。
- atlas 文件存在、可解码、尺寸非零。
- 帧宽、帧高、列数、行数与图片尺寸可整除。
- atlas 行数满足声明的动作集合。
- 每个动作引用合法行号和帧范围。
- 必需动作存在；可选动作缺失时有明确 fallback。
- animation duration/FPS 在安全范围内。
- Reduced Motion fallback 可解析。
- 资源路径不能逃逸 Pet 目录。
- 旧 manifest 版本只通过明确 migration/compatibility adapter 接入。

### 7.2 待决策

- [ ] 校验只在 CI/构建运行，还是安装自定义 Pet 时也运行？建议共用同一 validator。
- [ ] 可选动作缺失是 warning 还是 error？
- [ ] 是否扩展 manifest，声明 appearance 的动画兼容性元数据？
- [ ] 对旧版本 atlas 是拒绝、自动迁移还是只读兼容？

### 7.3 验收标准

- [ ] 损坏 manifest 在构建或安装阶段给出明确错误。
- [ ] atlas 行数不足、尺寸不可整除和动作越界均能被检测。
- [ ] validator 可通过 fixture 单元测试，不依赖真实 UI。
- [ ] runtime loader 与构建期检查使用同一领域规则或共享 schema。
- [ ] 校验错误不泄露不必要的绝对路径。
- [ ] 现有内置 appearance 全部通过校验。

### 7.4 建议提交拆分

1. `feat(pet): validate sprite manifests and atlases`
2. `test(pet): cover invalid pet asset fixtures`
3. `build(pet): enforce pet asset validation`

---

## 8. 候选 F：真实浏览器布局与无障碍回归

### [ ] F. 增加 5–8 个高价值浏览器级回归

- **状态：** 候选
- **建议优先级：** P1
- **目的：** 补充当前 mock DOM geometry 单元测试，验证真实 CSS、字体、缩放、滚动和焦点行为。
- **原则：** 不扩张为大规模端到端套件，只保留最能发现布局和可访问性回归的场景。

### 8.1 场景池

从以下场景选择 5–8 个，不建议一次覆盖全部组合：

- [ ] Pet 位于左上角。
- [ ] Pet 位于右上角。
- [ ] Pet 位于左下角。
- [ ] Pet 位于右下角。
- [ ] `180×160` 极小 viewport。
- [ ] Pet 尺寸 `80px`。
- [ ] Pet 尺寸 `224px`。
- [ ] 125% 缩放。
- [ ] 150% 缩放。
- [ ] 200% 缩放。
- [ ] 中文长文案。
- [ ] 英文长文案。
- [ ] 系统大字号。
- [ ] Activity Stack 内部滚动。
- [ ] Assistant composer/action 在极小 viewport 下可访问。
- [ ] Reduced Motion。
- [ ] Dialog interruption 焦点迁移。
- [ ] Escape 关闭后 mascot 焦点恢复。
- [ ] 打开完整对话时不错误恢复 mascot 焦点。

### 8.2 推荐最小场景集

如需直接采用默认方案，建议先保留以下 7 个：

1. 右下角 + Pet `224px` + Activity Stack 多通知。
2. `180×160` 极小窗口 + Assistant composer/action 内部滚动。
3. 200% 缩放 + 英文长文案。
4. 系统大字号 + 中文长文案。
5. Reduced Motion + appearance 预览。
6. ask/tool interruption 的键盘焦点迁移。
7. Assistant Escape 关闭与“打开完整对话”的不同焦点恢复行为。

### 8.3 待决策

- [ ] 使用 Electron E2E 还是普通 Playwright 浏览器级测试？
- [ ] 以 screenshot 为主，还是 DOM/geometry/focus 断言为主？建议结构断言为主，少量截图为辅。
- [ ] CI 是否运行全部缩放组合？
- [ ] 截图基线是否按操作系统区分？
- [ ] 字体差异导致的截图波动如何控制？
- [ ] 哪 5–8 个场景进入第一批？

### 8.4 验收标准

- [ ] 测试使用真实 CSS，而非完全 mock geometry。
- [ ] 关键按钮在目标 viewport 和缩放下可见或可滚动到达。
- [ ] 标题栏和关闭按钮在 resize 后保持可访问。
- [ ] Activity Stack 在内容超出时内部滚动，不把操作挤出 viewport。
- [ ] 焦点断言覆盖 interruption、Escape 和完整对话跳转。
- [ ] Reduced Motion 场景不依赖持续动画才能通过。
- [ ] CI 执行时间和截图波动保持可控。

### 8.5 建议提交拆分

1. `test(pet): add browser layout regression harness`
2. `test(pet): cover compact and zoomed pet layouts`
3. `test(pet): cover assistant focus flows in browser`

---

## 9. 候选 G：通知偏好后续增强

### [ ] G1. 自定义安静时长

- 允许用户选择自定义结束时间或更多预设。
- 明确跨重启和跨时区行为。
- 不允许无意中永久隐藏关键 waiting/failed 状态。

### [ ] G2. “直到应用重启”的安静模式

- 仅保存在当前应用 Session，不写入长期偏好。
- 应用崩溃恢复后是否继续安静需明确；建议不继续。

### [ ] G3. 通知偏好重置

- 可恢复默认来源、running/review/waving 和 actionable-only 策略。
- 与 Pet Library 外观重置分开，避免意外清空偏好。

### [ ] G4. 在主界面显示当前安静状态

- 用户无需打开设置即可确认 Pet 为何没有展示普通通知。
- 提供立即结束安静模式的操作。

### [ ] G5. 更细粒度来源策略

可能包括：

- Lesson Review；
- Todo；
- Learning Progress；
- 课程生成；
- Agent；
- Onboarding。

只有在真实来源接入后才增加对应开关，不能提前创建无数据的占位项。

### [ ] G6. 清理过期 `quietUntil`

- 过期后在合适的持久化边界归一化为空值。
- 清理不触发旧通知重播。
- 不在 render 阶段写持久化状态。

### 9.1 验收标准

- [ ] 所有新偏好均有中英文文案和默认值。
- [ ] migration 能处理旧设置和损坏值。
- [ ] waiting/failed 的关键可发现性规则仍成立。
- [ ] quiet mode 只影响通知展示，不影响 run 生命周期。
- [ ] 过期通知不会在 quiet mode 结束后批量重播。
- [ ] 来源策略继续由领域投影实现。

### 9.2 建议优先级

G1–G6 均为 P2，可在真实 Lesson/Todo 通知接入后按反馈选择；当前不阻塞后续核心功能。

---

## 10. 候选 H：Assistant Dialog 后续非阻塞增强

### [ ] H1. 真实屏幕阅读器验证

- 在 macOS VoiceOver 或目标平台屏幕阅读器中验证实际播报。
- 确认开始、interruption、完成、失败、取消只播报一次。
- 验证流式 token 不重复朗读整段消息。

### [ ] H2. 更长中英文文案的视觉验证

- 覆盖标题、suggestions、permission、Todo 导入状态和错误消息。
- 与候选 F 的真实浏览器布局回归合并实施。

### [ ] H3. Assistant geometry 独立设置入口

- 在设置或 Pet 菜单中提供“重置 Assistant 窗口”。
- 保留 Dialog 内现有重置能力。
- 不与 Pet 位置重置强绑定。

### [ ] H4. Todo 导入失败或部分成功反馈

- 区分全部成功、部分成功、全部失败。
- 列出可操作的失败原因，但不暴露内部技术细节。
- 重试必须幂等，避免重复创建 Todo。

### [ ] H5. 对话恢复期间的细化 loading 状态

- 明确区分 workspace 不存在、正在恢复 conversation、恢复失败和可以新建对话。
- loading 状态有可靠焦点 fallback。
- 恢复失败后不显示旧 conversation turns。

### 10.1 验收标准

- [ ] 增强项不重新引入 thread-level `aria-live`。
- [ ] 不把 modeless Dialog 改成模态焦点陷阱。
- [ ] 不破坏 IME、`Shift+Enter` 和 Escape 行为。
- [ ] Todo 重试不会重复导入。
- [ ] conversation 恢复失败后不会投影旧结果。
- [ ] geometry 与焦点行为有浏览器级或组件级回归覆盖。

### 10.2 建议优先级

H1–H5 均为 P2；除非收到明确可访问性或恢复问题反馈，否则可与候选 F 一并处理。

---

## 11. 全局架构与产品约束

无论选择哪一项，后续实现都必须遵守以下规则。

### 11.1 真实数据与 identity

- 只根据真实存在的 Lesson、Review、Todo、conversation、run 或 workspace 数据生成 UI 投影。
- 每条 notification 必须具有稳定业务 ID、真实目标 ID、明确来源和明确操作。
- 不使用展示文案、错误文本、随机 key 或临时时间戳作为业务 identity。
- canonical 数据与 Pet notification 分离；notification 是可重建投影，不是真相来源。

### 11.2 生命周期

每一种新通知都必须在实现前写清：

- 创建条件；
- 更新条件；
- 排序/优先级；
- 可执行操作；
- dismiss 作用域；
- 过期条件；
- 目标删除或移动后的处理；
- workspace 切换行为；
- 应用重启行为；
- 与安静模式和来源设置的关系。

### 11.3 可访问性

- 所有用户文案必须国际化。
- 交互必须可用键盘完成，不能只依赖 pointer drag/resize。
- 动态内容只播报关键事件，不播报每个流式 token。
- modeless 界面保持与主界面的正常交互，不增加错误焦点陷阱。
- Reduced Motion、系统大字号和浏览器缩放必须有明确行为。

### 11.4 领域投影

- 领域规则使用纯函数或独立模块表达。
- JSX 只消费投影结果，不拼接通知优先级、来源过滤或生命周期规则。
- projection 的输入、输出和失败模式必须可 fixture 测试。
- workspace 切换、取消、失败、恢复和删除必须清除不再有效的临时投影。

---

## 12. 明确不实施的事项

以下做法即使能快速展示效果，也不应进入实现：

- [!] 生成虚构后台任务或假装存在系统级计划任务。
- [!] 创建 Cloud Task 或后台占位通知。
- [!] 从错误消息字符串推断业务状态。
- [!] 使用随机 ID、展示文本或翻译结果作为 notification identity。
- [!] 因安静模式暂停、取消或改变真实业务 run。
- [!] 安静模式结束后批量重播已经过期的通知。
- [!] 把 modeless Assistant Dialog 改成模态焦点陷阱。
- [!] 在 JSX 中拼接通知来源、排序、过滤或 dismiss 领域规则。
- [!] 在没有真实数据来源前实现“智能提醒”。
- [!] 仅为了 Pet 提醒新增第二套 Todo、Review、Lesson 或 conversation 真相存储。
- [!] 让 notification 反向覆盖 canonical 学习数据。
- [!] appearance 加载失败时先清空旧 sprite 再尝试恢复。
- [!] 用大规模脆弱截图套件替代领域单元测试和少量高价值浏览器回归。

---

## 13. 取舍清单

可以直接编辑以下清单，确定下一轮范围。

### 13.1 核心功能

- [ ] A. 真实待复习 Lesson 通知
- [ ] B. 真实 Todo 今日提醒
- [ ] C. Workspace 长时间无进展提示

### 13.2 Pet Library 与资产可靠性

- [ ] D1. 预览区完整键盘操作
- [ ] D2. appearance 描述与动画兼容性提示
- [ ] D3. 分项/全部恢复默认
- [ ] D4. 键盘移动 Pet
- [ ] D5. appearance 加载失败时保留旧外观
- [ ] E. manifest/atlas 构建期严格校验

### 13.3 真实环境回归

- [ ] F. 选择 5–8 个浏览器级布局与焦点场景

### 13.4 可选增强

- [ ] G1. 自定义安静时长
- [ ] G2. 安静直到应用重启
- [ ] G3. 通知偏好重置
- [ ] G4. 主界面安静状态
- [ ] G5. 更细粒度来源设置
- [ ] G6. 过期 `quietUntil` 清理
- [ ] H1. 真实屏幕阅读器验证
- [ ] H2. 长文案视觉验证
- [ ] H3. Assistant geometry 独立设置入口
- [ ] H4. Todo 导入部分成功/失败反馈
- [ ] H5. conversation 恢复细化状态

---

## 14. 建议的实施与 GitHub 上传方式

用户选定范围后，每个独立部分采用以下流程：

1. 先确认领域规则、identity、生命周期和不包含范围。
2. 优先补纯函数/领域模型测试。
3. 实现最小垂直切片。
4. 补组件或浏览器级回归。
5. 运行相关检查、完整单元测试、typecheck 和 build。
6. 一个独立部分对应一个或少量可审查提交。
7. 每完成一部分立即 push 到 `origin/pet`，不把多个未确认候选混在同一批提交中。

建议最低验证集合：

```sh
pnpm test
pnpm run typecheck
pnpm run build
pnpm run check:pet-notifications
pnpm run check:pet-library
```

如修改 Assistant Dialog、sprite loader 或浏览器测试，再运行相应专项检查和 Playwright/Electron 测试。

---

## 15. 待用户确认的首轮选择

建议首轮只选择以下两种方案之一：

### 方案一：领域价值优先（推荐）

- [ ] A. 真实待复习 Lesson 通知最小垂直切片
- [ ] F. 为该切片增加 1–2 个必要的真实浏览器回归

### 方案二：体验与可靠性优先

- [ ] D1. Pet Library 键盘操作
- [ ] D5. appearance 失败时保留旧外观
- [ ] E. manifest/atlas 构建期校验
- [ ] F. 选择 5 个布局与焦点回归

不建议首轮同时选择 A、B、C 三种提醒来源。应先用 A 验证通知领域模型，再决定 Todo 和无进展提示是否值得扩展。
