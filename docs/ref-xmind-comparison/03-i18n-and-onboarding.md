# 国际化、本地化与用户引导对比

> **对比焦点**：多语言支持、文案覆盖、用户引导流程、快捷键系统、文件类型注册

---

## 1. 国际化对比

### Xmind 的国际化：15 种语言 × 3167 条文案

Xmind 支持 **15 种语言**，每种语言约 **3167 条 UI 文案**：

| 语言 | 文案条数 | 目录 |
|---|---|---|
| zh-CN（简体中文） | 3167 | `locales/zh-CN/translation.json` |
| zh-TW（繁体中文） | 3172 | `locales/zh-TW/translation.json` |
| en-US（美式英语） | 2879 | `locales/en-US/translation.json` |
| en-GB（英式英语） | 3051 | `locales/en-GB/translation.json` |
| ja-JP（日语） | 3170 | `locales/ja-JP/translation.json` |
| ko（韩语） | 3139 | `locales/ko/translation.json` |
| de-DE（德语） | 3166 | `locales/de-DE/translation.json` |
| fr-FR（法语） | 3143 | `locales/fr-FR/translation.json` |
| es（西班牙语） | 3141 | `locales/es/translation.json` |
| it-IT（意大利语） | 3141 | `locales/it-IT/translation.json` |
| pt-PT（葡萄牙语） | 3141 | `locales/pt-PT/translation.json` |
| ru-RU（俄语） | 3141 | `locales/ru-RU/translation.json` |
| id（印尼语） | 3341 | `locales/id/translation.json` |
| th（泰语） | 3141 | `locales/th/translation.json` |
| kk（哈萨克语） | 3197 | `locales/kk/translation.json` |

**文案覆盖范围**（从 translation.json 分类可见）：
- 菜单项（文件/编辑/视图/插入/修改/工具/窗口/帮助）
- 对话框标题与按钮
- 工具提示（tooltip）
- 空状态文案
- 错误消息
- 快捷键描述
- 功能说明文字
- 付费/订阅相关文案
- 模板名称
- 主题名称
- 日期/时间格式化
- 导出格式选项
- 协作功能文案
- 引导教程文案

### StudiumX 的国际化：2 种语言 × 45 条文案

StudiumX 使用 i18next，支持 **2 种语言**，每种仅约 **45 条文案**：

| 语言 | 文案条数 | 文件 |
|---|---|---|
| en-US | ~45 | `src/renderer/src/i18n/locales/en-US.json` |
| zh-CN | ~45 | `src/renderer/src/i18n/locales/zh-CN.json` |

另有 `ui-language-catalog.ts` 管理可选语言列表。

### 差距分析

| 维度 | Xmind | StudiumX | 差距 |
|---|---|---|---|
| 支持语言数 | 15 | 2 | **13 倍差距** |
| 文案条数 | ~3167 | ~45 | **70 倍差距** |
| 文案覆盖率 | ~95%（全覆盖） | ~5%（仅核心 UI） | **极大差距** |
| 语言切换 | ✅ | ✅ | ✅ |
| 语言目录管理 | 独立 JSON | i18next + JSON | ✅ |
| 多语言定价 | ✅ pricing.json | N/A | N/A |

### 文案覆盖率对比（具体类别）

| 文案类别 | Xmind 条数 | StudiumX 估计 | 差距 |
|---|---|---|---|
| 菜单项 | ~200+ | ~10 | 极大 |
| 对话框文案 | ~500+ | ~5 | 极大 |
| 工具提示 | ~300+ | ~10 | 极大 |
| 错误消息 | ~100+ | ~5 | 极大 |
| 思维导图功能 | ~400+ | ~5 | 极大 |
| 导出/导入 | ~50+ | 0 | 完全缺失 |
| 快捷键描述 | ~100+ | 0 | 完全缺失 |
| 引导教程 | ~50+ | 0 | 完全缺失 |

### 借鉴建议

> **这是最大的差距，也是最容易系统性改进的领域。**

#### 短期（P0）
1. **文案提取**：将 StudiumX 中所有硬编码中文字符串提取为 i18n key
   - 使用 `i18next-scanner` 或类似工具自动提取
   - 先覆盖核心界面（侧边栏、设置、对话框标题/按钮）
2. **文案扩展**：将 en-US 和 zh-CN 各从 45 条扩展到至少 500 条
   - 覆盖所有菜单、对话框、工具提示、错误消息
3. **缺失文案检测**：添加 `check:i18n-coverage` 脚本检测硬编码字符串

#### 中期（P1）
4. **增加语言**：参考 Xmind 的 15 种语言，优先增加：
   - ja-JP（日语）- 亚洲市场
   - ko（韩语）- 亚洲市场
   - en-GB（英式英语）- 欧洲
5. **社区翻译**：提供翻译贡献指南，利用开源社区力量

#### 长期（P2）
6. **完整多语言**：覆盖 Xmind 支持的全部 15 种语言
7. **语言包动态加载**：按需加载语言包，减小初始包体积

---

## 2. 用户引导（Onboarding）对比

### Xmind 的用户引导系统

Xmind 有完整的用户引导体系，由多个独立对话框组成：

| 引导组件 | HTML | 内容 |
|---|---|---|
| 欢迎页 | `welcome.html` | 首次启动欢迎、最近文件、新建/打开 |
| 新建页 | `new.html` | 从模板/空白/图库新建 |
| Onboarding 教程 | `dialog-onboarding.html` | 3 步创建第一张思维导图 |
| 快速入门指南 | `dialog-quick-entry-guide.html` | 快速操作指南 |
| 快捷键面板 | `dialog-keyassist.html` | 可搜索的快捷键列表 |
| 更新提示 | `dialog-auto-updater.html` | 版本更新引导 |
| 评分引导 | `dialog-rate.html` | 邀请用户评分 |
| 恭贺对话框 | `dialog-congratulate.html` | 完成成就恭贺 |

**引导教程文案**（从 translation.json）：

```
"Welcome to Xmind. Now, let's create your first mind map with your keyboard
and the 3-step tutorial below. If you want to start later, you can always
find the tutorial in "Help" menu."
= 欢迎使用 Xmind。根据我的指引，你可以通过键盘3步完成一张思维导图。
如果你想稍后再尝试，你可以在"帮助"中找到它。
```

### StudiumX 的用户引导

StudiumX 目前的引导组件：
- `EmptyStartSheet.tsx` - 空状态启动页
- `MigrationBannerSheet.tsx` - 迁移提示
- `AppUpdateDialog.tsx` - 更新对话框
- `AuthLoginScreen.tsx` / `AuthScreenLayout.tsx` - 登录引导

### 差距

| 引导功能 | Xmind | StudiumX | 借鉴价值 |
|---|---|---|---|
| 首次启动引导 | ✅ welcome + 3 步教程 | ✅ EmptyStartSheet | 中 |
| 快捷键面板 | ✅ 可搜索 | ✗ | **高** |
| 功能发现引导 | ✅ quick-entry-guide | ✗ | **高** |
| 更新引导 | ✅ | ✅ | ✅ |
| 评分引导 | ✅ | ✗ | 低 |
| 恭贺反馈 | ✅ | ✗ | 中 |
| 反馈通道 | ✅ feedback.html | ✗ | 中 |

### 借鉴建议

#### 高优先级

1. **快捷键面板**（`dialog-keyassist` 模式）：
   - 唤起方式：`Cmd+/` 或 `Cmd+Shift+/`
   - 功能：可搜索的快捷键列表
   - 覆盖范围：全局快捷键 + 思维导图快捷键 + 工作台快捷键
   - 已有基础：`mind-map-keyboard.ts`、`mind-map-keyboard-navigation.ts`
   - 需要：统一的全局快捷键注册 + 搜索 UI

2. **首次教学引导**：
   - StudiumX 是教学产品，首次引导尤为重要
   - 引导用户：创建工作区 -> 写 MISSION.md -> 配置 AI -> 开始教学对话
   - 借鉴 Xmind 的 3 步教程模式，但适配教学场景

3. **功能发现**：
   - 新功能提示（类似 Xmind 的 quick-entry-guide）
   - 可通过 `FEATURES` 表中的 `since` 字段判断新功能

#### 中优先级

4. **反馈通道**：内置反馈入口（提交到 GitHub Issues 或邮箱）
5. **恭贺反馈**：完成学习目标时的恭贺动画（与 Pet 系统联动）

---

## 3. 快捷键系统对比

### Xmind 的快捷键系统

从 `translation.json` 可见：

```
"Shortcuts" = 快捷键
"Shortcut Used by Another Action" = 快捷键被占用
"Enter a Shortcut" = 输入快捷键
"Customize Shortcut" = 自定义快捷键
"Restore Default Shortcuts" = 重置默认快捷键
"Shortcut List" = 快捷键列表
"Search shortcuts" = 搜索快捷键
"Show Keyboard Shortcuts" = 显示快捷键
```

**功能**：
- 完整的快捷键注册表
- 用户可**自定义**快捷键
- 检测快捷键冲突
- 可搜索快捷键列表
- 可恢复默认

### StudiumX 的快捷键系统

- `mind-map-keyboard.ts` - 思维导图快捷键
- `mind-map-keyboard-navigation.ts` - 键盘导航
- `check:message-history-keyboard` - 消息历史键盘检查

### 差距

| 功能 | Xmind | StudiumX |
|---|---|---|
| 快捷键注册 | ✅ 完整 | ✅ 部分（仅思维导图） |
| 快捷键搜索 | ✅ | ✗ |
| 快捷键自定义 | ✅ | ✗ |
| 冲突检测 | ✅ | ✗ |
| 恢复默认 | ✅ | ✗ |

### 借鉴建议

> **快捷键面板是高价值低成本的功能**：
> 1. 建立全局快捷键注册表（centralized keybinding registry）
> 2. 添加可搜索的快捷键面板 UI
> 3. 后期可增加自定义功能

---

## 4. 文件类型注册与深链接

### Xmind 的文件类型注册

Xmind 在 `Info.plist` 中注册了完整的文件类型：

| 扩展名 | UTI | 类型 | 角色 |
|---|---|---|---|
| `.xmind` | `org.xmind.openformat.xmind` | Xmind Workbook | Owner |
| `.xmap` | `org.xmind.openformat.xmap` | Xmind 2007/2008 Workbook | Owner |
| `.xmt` | `org.xmind.openformat.xmt` | Xmind Template | Owner |
| `.xmp` | `org.xmind.openformat.xmp` | Xmind Markers Package | Owner |
| `.xrb` | `org.xmind.openformat.xrb` | Xmind Resource Bundle | Owner |
| `.mm` | `net.sourceforge.freemind.mm` | FreeMind Mindmap | Alternate |
| `.mmap` | `com.mindjet.mindmanager.mmap` | Mindjet MindManager Mindmap | Alternate |
| `.md` / `.markdown` | - | Markdown Document | Alternate |
| TextBundle | `org.textbundle.package` | TextBundle Document | Viewer |

**URL Scheme**：
- `xmind://` - 深链接
- `xmind-zen://` - ZEN 模式深链接

**MIME 类型**：
- `application/vnd.xmind.workbook`

### StudiumX 的文件类型注册

StudiumX **未注册**任何 OS 级文件类型或 URL Scheme。

### 差距

| 功能 | Xmind | StudiumX | 借鉴价值 |
|---|---|---|---|
| 文件类型注册 | ✅ 9 种 | ✗ | **高** |
| MIME 类型 | ✅ | ✗ | **高** |
| URL Scheme | ✅ 2 个 | ✗ | **高** |
| 文件图标 | ✅ .icns | ✗ | 中 |
| 模板文件类型 | ✅ .xmt | ✗ | 低 |

### 借鉴建议

> **文件类型注册是桌面应用的基本专业性体现**，也直接影响用户体验：

1. **注册 `.studiumx` 或 `.sx` 文件类型**：
   - 包含工作区配置 + 学习记录
   - 双击在 StudiumX 中打开
   - 设置自定义文件图标

2. **注册思维导图文件类型**：
   - `.sxmind` 或继续支持 `.xmind`
   - 双击打开思维导图编辑器

3. **注册 Markdown 关联**：
   - 课程讲义 `.md` 文件可关联 StudiumX 打开
   - 作为系统 Markdown 编辑器的替代

4. **URL Scheme `studiumx://`**：
   - `studiumx://open?workspace=xxx` - 打开工作区
   - `studiumx://lesson?id=xxx` - 打开课程讲义
   - `studiumx://mindmap?id=xxx` - 打开思维导图
   - 支持从 Web 端 / 邮件链接直接跳转到桌面应用

5. **在 `electron-builder` 配置中注册**：
   ```json
   {
     "fileAssociations": [
       { "ext": "studiumx", "name": "StudiumX Workspace", "role": "Editor" },
       { "ext": "md", "name": "Markdown", "role": "Viewer" }
     ]
   }
   ```

---

## 5. 自动更新对比

### Xmind

- `dialog-auto-updater.html` + `dialog-auto-updater.js`
- 从 translation.json：
  - "Please update to the latest version" = 请更新最新版本
  - "Skip This Version" = 跳过该版本
  - "This Xmind version has expired" = 此 Xmind 版本已过期
  - 版本检查 + 下载 + 安装引导

### StudiumX

- `app-updater.ts`（12.8KB）
- `AppUpdateDialog.tsx`
- 已有基础

### 对比

两者都有自动更新。StudiumX 已有基础，可借鉴 Xmind 的"跳过此版本"功能。

---

## 6. 设置（Preferences）对比

### Xmind 的设置

`preferences.html` 是独立窗口，从 translation.json 可推断设置分类：
- 通用设置（语言、启动行为、自动保存）
- 快捷键设置（自定义快捷键）
- 外观设置（主题、暗色模式）
- 同步设置（云端同步、统计上传）
- 高级设置（文件缓存、数据脱敏）

### StudiumX 的设置

`SettingsView.tsx` 内嵌在主窗口，分区：
- `ModelProviderSettingsSection` - 模型提供商
- `UserMcpSettingsSection` / `UserMcpServerEditor` / `UserMcpServerList` - MCP
- `RemoteControlSettingsSection` - 远程控制
- `TeachingDoctorSettingsSection` - 教学诊断
- `TeachingTurnReviewSettingsSection` - 回合审查
- `AgentSessionQueueDiagnostics` - Agent 队列诊断

### 对比

| 维度 | Xmind | StudiumX |
|---|---|---|
| 设置位置 | 独立窗口 | 主窗口内嵌 |
| 设置分类 | 通用/快捷键/外观/同步/高级 | AI/MCP/远程/教学/诊断 |
| 快捷键设置 | ✅ 可自定义 | ✗ |
| 外观设置 | ✅ 主题/暗色 | ✅ 暗色检查 |
| 统计设置 | ✅ 上传统计 | ✗ 无遥测（设计选择） |

### 借鉴建议

> StudiumX 的设置面板已足够丰富。可借鉴：
> 1. 增加**快捷键设置分区**
> 2. 增加**通用设置**（语言、启动行为、自动保存间隔）
> 3. 增加**外观设置**分区（主题选择、暗色模式切换）

---

## 7. 总结

| 领域 | 差距程度 | 借鉴优先级 |
|---|---|---|
| 国际化文案覆盖 | **极大**（70 倍差距） | **P0** |
| 多语言数量 | **大**（15 vs 2） | P1 |
| 快捷键面板 | 大 | **P0** |
| 首次引导教程 | 中 | P1 |
| 文件类型注册 | 大 | **P0** |
| URL Scheme | 大 | P1 |
| 快捷键自定义 | 中 | P2 |
| 功能发现引导 | 中 | P1 |
| 设置完善 | 中 | P2 |
| 反馈通道 | 低 | P2 |
