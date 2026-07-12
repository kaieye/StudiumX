# Codex app Pet 宠物功能实现分析

> 本文是对当前本机 Codex app 的只读静态分析记录，目的是在后续开发或排查时直接查阅，不必重复解包和定位。

## 1. 分析元信息

| 项目 | 值 |
|---|---|
| 分析日期 | 2026-07-12 |
| 时区 | Asia/Shanghai |
| App 路径 | `/Applications/ChatGPT.app` |
| Bundle Identifier | `com.openai.codex` |
| Version | `26.707.51957` |
| Build | `5175` |
| Electron 主包 | `/Applications/ChatGPT.app/Contents/Resources/app.asar` |
| macOS 原生扩展 | `/Applications/ChatGPT.app/Contents/Resources/native/avatar-overlay.node` |
| Dock 插件 | `/Applications/ChatGPT.app/Contents/PlugIns/CodexDockTilePlugin.plugin` |
| Pet 协议文档 | `/Applications/ChatGPT.app/Contents/Resources/skills/skills/.curated/hatch-pet/references/codex-pet-contract.md` |
| Hatch Pet skill | `/Applications/ChatGPT.app/Contents/Resources/skills/skills/.curated/hatch-pet/SKILL.md` |

本次分析没有下载安装包或外部资源，也没有修改 `/Applications/ChatGPT.app`。分析时使用的只读提取副本位于：

- `/tmp/codex-pet-inspect`
- `/tmp/codex-pet-pretty`

`/tmp` 内容可能随系统重启或清理而消失，因此它们只是本次分析的辅助证据，不是长期资料源。长期定位应以上表中的 App 原始路径、版本号和 build 号为准。

## 2. 快速结论

Pet 的主体不是 Dock Tile 插件，也不是 GIF、Canvas 或 WebGL 动画。当前构建采用以下组合：

```text
Electron 透明桌面 overlay
+ React renderer
+ CSS spritesheet 状态动画
+ macOS 原生 composition addon
```

Pet 会把本地 Conversations 与 Cloud Tasks 归一化成 Session，计算通知和状态，选出最高优先级通知，再将其映射为宠物动作。拖动、悬停等临时交互状态可以覆盖会话状态。

```text
Local Conversations + Cloud Tasks
                 │
                 ▼
          统一 Session 模型
                 │
                 ▼
        Notification 状态与排序
                 │
                 ▼
          notifications[0]
                 │
                 ▼
            mascotState
                 │
          ┌──────┴──────┐
          │ transient   │
          │ drag/hover  │
          └──────┬──────┘
                 ▼
      CSS spritesheet 对应帧/动作行
                 │
                 ▼
    macOS composition surface（可回退 CSS）
```

## 3. Overlay 窗口实现

### 3.1 BrowserWindow 外观

Pet 是独立透明浮层窗口。当前构建的核心配置包括：

```js
{
  type: "panel",       // macOS
  frame: false,
  transparent: true,
  hasShadow: false,
  skipTaskbar: true
}
```

此外还会：

- 使用 `setAlwaysOnTop(true, "floating")` 保持浮层可见。
- 设置为所有 Workspace 可见，包括全屏 Workspace。
- 默认启用鼠标穿透：`setIgnoreMouseEvents(true, { forward: true })`。
- 当指针命中实际交互区域时关闭穿透，使通知、输入框、拖动和缩放可操作。
- 输入框激活时临时调用 `setFocusable(true)`，允许输入。
- 使用状态键 `electron-avatar-overlay-open` 记录 overlay 是否打开。

### 3.2 尺寸、位置和多显示器

| 参数 | 当前构建中的值 |
|---|---:|
| 默认窗口尺寸 | `112 × 121 px` |
| 可缩放宽度 | `80–224 px` |
| 宠物宽高比 | `192 / 208` |
| 默认位置 | 主显示器右下角 |
| 默认边缘距离 | 约 `24 px` |
| Legacy viewport | `356 × 320` |
| Native surface viewport | `384 × 400` |

窗口位置按显示器 ID 和显示器分辨率分别保存。显示器断开后，程序会保留约 10 秒的恢复机会，以处理短暂断连或显示器重新枚举。拖动和投掷可以跨显示器。

### 3.3 鼠标穿透策略

透明 overlay 并不是整块窗口始终拦截鼠标。它通常处于穿透状态，仅在鼠标位于真正可交互的内容区域时接管输入。这样可以让用户正常点击宠物背后的应用，同时仍可操作：

- 宠物本体；
- 通知卡片；
- Composer 输入框；
- Badge 和 activity stack；
- Resize handle。

这是 Pet 看起来像“桌面挂件”而不是普通 Electron 窗口的关键之一。

## 4. 会话聚合、通知和状态优先级

### 4.1 通知排序

Pet 同时观察本地 conversation 与 cloud task，将需要用户注意的状态聚合成通知。排序规则如下：

| 状态 | 优先级（越小越高） | 过期时间 |
|---|---:|---:|
| `waiting` | 0 | 24 小时 |
| `failed` | 1 | 1 小时 |
| `review` | 2 | 7 天 |
| `running` | 3 | 3 分钟 |
| `idle` | 4 | 不生成普通通知 |

Renderer 主要消费排序后的 `notifications[0]`，即当前最高优先级的一条通知。因此多个任务并存时，宠物动作和主要通知会优先表达最需要用户处理的会话。

首次唤醒还有一条持续约 8 秒的介绍通知：

```text
Hi, I'm {petName}
I'm here to help keep your ChatGPT sessions moving
```

### 4.2 通知到视觉状态的映射

| 输入 | 宠物状态 |
|---|---|
| `isLoading` | `running` |
| warning | `waiting` |
| danger | `failed` |
| success | `review` |
| info 或无通知 | `idle` |
| first-awake | `waving` |

### 4.3 本地 conversation 状态判定

| Conversation 情况 | 归一化状态 |
|---|---|
| command approval | `waiting` |
| file approval | `waiting` |
| permission 请求 | `waiting` |
| user input 请求 | `waiting` |
| MCP elicitation | `waiting` |
| 尚未实施的 plan | `waiting` |
| system error / failed turn | `failed` |
| active / resuming / in-progress | `running` |
| 有未读输出 | `review` |
| 其他 | `idle` |

### 4.4 Cloud task 状态判定

| Cloud task 情况 | 归一化状态 |
|---|---|
| failed / cancelled | `failed` |
| pending / in_progress | `running` |
| 有未读结果 | `review` |
| 其他 | `idle` |

### 4.5 通知支持的操作

通知层不仅展示状态，还支持直接处理或跳转：

- command approval；
- file approval；
- permission response；
- MCP elicitation；
- plan start；
- question option；
- follow-up reply；
- 打开原 conversation；
- 打开 Quick Chat / projectless task；
- 停止正在运行的任务。

## 5. 精灵动画实现

### 5.1 渲染方式

宠物动画的基础渲染是普通 DOM 元素和 CSS 背景图：

```text
<div>
  + background-image
  + background-position
  + image-rendering: pixelated
```

JavaScript 使用递归 `setTimeout` 推进帧序号，再通过 CSS `background-position` 切换 atlas 中的格子。它不是 GIF、Canvas 或 WebGL。

开启 Reduced Motion 时只显示动作的第一帧，不连续播放精灵动画。

### 5.2 Atlas 规格

每个精灵格固定为 `192 × 208 px`，每行 8 帧。

| Sprite version | 网格 | 总尺寸 |
|---|---|---|
| v1 | `8 × 9` | `1536 × 1872 px` |
| v2 | `8 × 11` | `1536 × 2288 px` |

CSS 背景尺寸采用：

```text
background-size: 800% × (rowCount × 100%)
```

### 5.3 动作行定义

| Row | 动作 |
|---:|---|
| 0 | `idle` |
| 1 | `running-right` |
| 2 | `running-left` |
| 3 | `waving` |
| 4 | `jumping` |
| 5 | `failed` |
| 6 | `waiting` |
| 7 | `running` |
| 8 | `review` |
| 9 | look direction 0–7，仅 v2 |
| 10 | look direction 8–15，仅 v2 |

普通的非 `idle` 动画通常播放三轮，随后回到速度较慢的 idle 动画。

### 5.4 内置宠物

当前构建中识别到以下内置宠物：

- Codex
- Dewey
- Fireball
- Hoots
- Rocky
- Seedy
- Stacky
- BSOD
- Null Signal

它们共享同一套状态和 atlas 协议，主要差异是精灵图、名称和描述。

## 6. v2 鼠标注视方向

只有 `spriteVersionNumber === 2` 的宠物支持 16 方向注视。方向计算等价于：

```js
dx = mouse.x - center.x
dy = mouse.y - center.y
angle = (atan2(dx, -dy) * 180 / Math.PI + 360) % 360
direction = round(angle / 22.5) % 16
```

规则：

- 鼠标距离宠物中心不超过 1 px 时，不进入注视状态。
- `direction` 为 0–7 时使用第 9 行。
- `direction` 为 8–15 时使用第 10 行。
- 每个方向对应所在行中的一格，因此 v2 比 v1 多两行。

## 7. Hover、拖动、投掷与缩放

### 7.1 临时状态覆盖

最终显示状态的优先关系可简化为：

```js
state =
  horizontalDragState ??
  (hover ? "jumping" : sessionDerivedState)
```

也就是说：

1. 水平拖动动作优先级最高；
2. 没有拖动时，hover 显示 `jumping`；
3. 没有临时交互时，才显示会话派生的 `idle/running/waiting/failed/review`。

### 7.2 拖动和投掷

| 参数 | 行为 |
|---|---|
| 拖动识别阈值 | 约 4 px |
| 向右拖 | `running-right` |
| 向左拖 | `running-left` |
| 速度采样窗口 | 最近约 160 ms |
| 最低投掷速度 | 约 320 px/s |
| 最大投掷速度 | 约 1600 px/s |
| 主进程动画 timer | 约 8 ms |

松手后主进程根据采样速度继续移动窗口，并应用摩擦、屏幕边缘碰撞和 bounce。投掷逻辑能够处理多显示器边界。

### 7.3 缩放

Resize handle 使用 Pointer Capture，避免指针在缩放过程中离开控件后丢失事件。宽度被限制为 `80–224 px`，高度按 `192/208` 的精灵比例联动。

## 8. macOS Native Composition

### 8.1 加载条件

原生扩展位于：

```text
/Applications/ChatGPT.app/Contents/Resources/native/avatar-overlay.node
```

它只在 macOS 加载；当 `process.platform !== "darwin"` 时，加载入口返回 `null`。因此 CSS/BrowserWindow 方案仍是必要的回退路径。

### 8.2 元素测量与 IPC

Renderer 使用 `ResizeObserver` 测量 overlay 中的主要视觉区域，包括：

- mascot；
- tray；
- notification row；
- composer；
- badge；
- activity stack 的 visible height 和 backing height。

相关 IPC 事件包括：

```text
avatar-overlay-element-size-changed
avatar-overlay-composition-changed
```

### 8.3 Composition surfaces

识别到的 surface 包括：

- `composer`
- `activity-slot-0` 至 `activity-slot-6`
- `mascot-badge`
- activity stack backing/effect layer

每个 surface 对应独立透明 BrowserWindow，典型配置为：

```js
{
  acceptFirstMouse: true,
  transparent: true,
  frame: false,
  hasShadow: false,
  focusable: false,
  resizable: false,
  skipTaskbar: true,
  backgroundThrottling: false
}
```

它们的生命周期可概括为：

```text
created
  → did-finish-load
  → mounted
  → painted-before-attach
  → native-attached
  → painted
  → presented
```

### 8.4 原生接口

从 addon 接口和二进制字符串中确认到以下能力：

- `attachCompositionMaterial`
- `animateCompositionSurface`
- `orderCompositionSurfaces`
- `presentNotificationStack`
- `setNotificationStackExpanded`
- `performOverlayWindowDrag`
- `getCompositionPointerSurfaceId`
- `consumeCompositionPointerDownSurfaceId`
- `consumeCompositionPointerUpSurfaceId`

这套实现负责 native material、多个 surface 的层级/动画、通知栈展示、窗口拖动和指针 surface 命中协调。

如果 native attach 或 composition 流程失败，程序会执行类似以下回退：

```text
detach-native-and-use-css-fallback
```

因此 Native Composition 是 macOS 上的增强层，而不是 Pet 状态机和精灵动画的唯一实现。

## 9. 自定义宠物协议

### 9.1 目录结构

自定义宠物默认放在：

```text
${CODEX_HOME:-$HOME/.codex}/pets/<directory-name>/
├── pet.json
└── spritesheet.webp
```

也可以使用 PNG，具体文件名由 `spritesheetPath` 指定。

协议文档中的 manifest 形式为：

```json
{
  "id": "pet-name",
  "displayName": "Pet Name",
  "description": "One short sentence.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

### 9.2 实际 loader 行为

实际 loader 比协议示例更宽松：

| 字段 | 实际行为 |
|---|---|
| `id` | 可省略 |
| `displayName` | 可省略 |
| `description` | 可省略或为 `null` |
| `spriteVersionNumber` | 默认 1，只接受 1 或 2 |
| `spritesheetPath` | 默认 `spritesheet.webp` |

最终运行时 ID 并不直接使用 manifest 的 `id`，而是：

```text
custom:<目录名>
```

显示名称的 fallback 顺序是：

```text
manifest.displayName
?? manifest.id
?? directoryName
```

因此目录名具有运行时身份意义；移动或重命名目录会改变该宠物的最终 ID。

### 9.3 图片校验

Loader 会执行以下检查：

- 使用 `path.resolve` 和 `path.relative` 阻止绝对路径及 `../` 词法路径穿越；
- 根据 magic bytes 识别 PNG 或 WebP，不只依赖扩展名；
- v1 图片尺寸必须精确为 `1536 × 1872 px`；
- v2 图片尺寸必须精确为 `1536 × 2288 px`；
- `spriteVersionNumber` 只能为 1 或 2；
- 无效目录会被跳过，不会作为可选宠物加载。

本地目录 loader 中没有观察到：

- 明确的图片文件大小上限；
- 对透明背景的验证；
- 对每一行动作语义是否正确的验证；
- 面向单个无效宠物的详细 UI 错误；
- 对 `realpath` 后路径或 symlink 最终目标的 containment 检查。

最后一点只代表静态代码中未发现对应检查，不能单独视为已经验证的可利用漏洞。若未来处理不可信宠物包，应额外复核 symlink、解码器资源消耗和超大本地文件场景。

### 9.4 旧版兼容

Loader 还兼容旧目录：

```text
~/.codex/avatars/*/avatar.json
```

如果新 `pets` 与旧 `avatars` 产生相同运行时 ID，新 pets 条目覆盖旧 avatars 条目。

分析时本机状态：

- `~/.codex/pets` 已存在，但目录为空；
- `~/.codex/avatars` 不存在。

## 10. URL 安装入口及安全限制

当前构建存在从 URL 安装宠物图片的实现。本次分析只查看了代码，**没有调用该入口，也没有下载任何资源**。

网络获取限制包括：

- 仅允许 HTTPS；
- 拒绝 localhost；
- 不允许 HTTP redirect；
- `Content-Type` 仅允许 `image/png` 或 `image/webp`；
- 响应最大约 20 MiB；
- 下载后仍会验证 magic bytes；
- 下载后验证 atlas 尺寸是否与 sprite version 一致。

安装过程会：

1. 将名称 slugify；
2. 将 slug 限制在最长 80 字符；
3. 若目录重名，追加 `-2`、`-3` 等后缀；
4. 写入 `pet.json`；
5. 写入 `spritesheet.png` 或 `spritesheet.webp`；
6. 返回 `custom:<slug>` 作为运行时 ID。

## 11. Hatch Pet skill 的职责

内置 `hatch-pet` skill 是宠物素材的制作与验证流水线，不是 overlay runtime 本身。

它负责：

- 生成 9 个标准动作行；
- 为 v2 生成 16 个 look directions；
- 拼装 `8 × 11` atlas；
- 执行视觉 QA；
- 执行确定性的尺寸检查；
- 输出 manifest 与 spritesheet。

运行时只消费：

```text
pet.json + spritesheet.png/webp
```

运行时不关心 spritesheet 是由 Hatch skill、人工绘制还是其他工具生成，只要求格式和尺寸符合协议。

## 12. Dock Tile Plugin 与 Pet 无关

`CodexDockTilePlugin.plugin` 不是 Pet overlay 的实现。二进制中观察到的主要字符串包括：

- `DockIconPreference`
- `DockIconResourceName`
- `icon-codex-light`
- `icon-codex-dark-color`
- `updateDockTile`

它负责 Dock 图标、主题偏好和 Dock 菜单相关能力；没有发现其承担宠物状态机、透明 overlay、精灵动画或自定义宠物加载。因此后续分析 Pet 时无需从 Dock Tile 插件开始。

## 13. 当前构建的源码定位索引

以下行号来自本次只读提取和格式化副本，仅适用于 Version `26.707.51957` / Build `5175`。App 升级或重新打包后，文件 hash 和行号很可能变化。

### 13.1 主进程

| 内容 | 本次证据位置 |
|---|---|
| Overlay 主类附近 | `/tmp/codex-pet-pretty/main.js:30069` |
| 创建 overlay 窗口 | `/tmp/codex-pet-pretty/main.js:30411` |
| 窗口位置持久化 | `/tmp/codex-pet-pretty/main.js:30721` |
| 鼠标穿透 | `/tmp/codex-pet-pretty/main.js:30767` |
| appearance 配置 | `/tmp/codex-pet-pretty/main.js:33191` |
| Native addon 加载入口 | `/tmp/codex-pet-pretty/main.js:29843` |
| Native composition fallback | `/tmp/codex-pet-pretty/main.js:4529` |
| Surface BrowserWindow | `/tmp/codex-pet-pretty/main.js:4544` |
| URL 安装入口 | `/tmp/codex-pet-pretty/main.js:12391` |

### 13.2 Renderer 与状态逻辑

| 内容 | 本次证据位置 |
|---|---|
| 会话聚合、通知排序、拖动选择逻辑 | `/tmp/codex-pet-pretty/webview_assets_use-avatar-overlay-selection-i0VMmzZH.js:7`、`:57` |
| Renderer 使用第一条通知 | `/tmp/codex-pet-pretty/webview_assets_avatar-overlay-page-Ds1nq07-.js:18` |
| 拖动/resize 交互 | `/tmp/codex-pet-pretty/webview_assets_avatar-overlay-page-Ds1nq07-.js:699` |
| 视觉状态映射 | `/tmp/codex-pet-pretty/webview_assets_avatar-overlay-pill-material.module-w1KJHlL9.js:17` |
| 16 方向注视计算 | `/tmp/codex-pet-pretty/webview_assets_avatar-overlay-pill-material.module-w1KJHlL9.js:7` |
| 精灵动画组件 | `/tmp/codex-pet-pretty/webview_assets_codex-avatar-BrvlA98k.js:26` |
| 精灵 CSS | `/tmp/codex-pet-inspect/webview_assets_codex-avatar-CBhzyYwb.css:1` |
| Native overlay page | `/tmp/codex-pet-pretty/webview_assets_avatar-overlay-native-page-BnP68-RO.js` |
| Native frame | `/tmp/codex-pet-pretty/webview_assets_avatar-overlay-native-frame-DGJfyN8O.js` |
| Mascot button | `/tmp/codex-pet-pretty/webview_assets_avatar-mascot-button-Djth3Nl2.js` |
| 内置宠物列表 | `/tmp/codex-pet-pretty/webview_assets_app-initial~app-main~page-opV5Hy6a.js:7776` |

### 13.3 自定义宠物 loader

| 内容 | 本次证据位置 |
|---|---|
| pets/avatars 扫描、manifest 与图片校验 | `/tmp/codex-pet-inspect/.vite_build_src-BlTl_Ip2.js:459` |

## 14. 后续使用建议与版本边界

在同一构建中讨论 Pet 的行为时，可以直接以本文为基础，无需重新解包。

出现以下情况时应重新做针对性验证：

- `/Applications/ChatGPT.app` 的 Version 或 Build 改变；
- `app.asar`、`avatar-overlay.node` 或 `hatch-pet` 协议文件发生变化；
- 自定义宠物无法加载，且 manifest/尺寸已经符合本文协议；
- Overlay 在新版 macOS 上出现窗口层级、全屏、多显示器或点击穿透差异；
- 需要把“静态分析结论”提升为安全审计结论或动态运行时结论。

升级后的快速复核优先级建议：

1. 先检查 bundle ID、Version 和 Build；
2. 搜索 `electron-avatar-overlay-open` 与 `avatar-overlay-composition-changed`；
3. 检查 spritesheet 尺寸、动作行和状态映射是否改变；
4. 检查自定义 pet loader 的字段默认值、路径校验和尺寸校验；
5. 检查 `avatar-overlay.node` 的导出接口及 fallback 是否变化；
6. 最后再更新本文的构建信息和源码索引。

## 15. 结论摘要

当前 Codex Pet 是一个与任务状态深度结合的 Electron 桌面浮层：React 负责 UI 与状态组合，CSS spritesheet 负责像素宠物动作，Electron 主进程负责透明窗口、位置、投掷和多显示器，macOS 原生 addon 负责 composition material 与多 surface 展示。自定义宠物本质上是遵守固定 atlas 尺寸和动作行协议的 manifest 加图片目录；Hatch Pet skill 负责生产素材，Dock Tile 插件则属于另一条完全独立的功能链路。
