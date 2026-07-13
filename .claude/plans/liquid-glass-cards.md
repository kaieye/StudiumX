# 自习室卡片：真正的液态玻璃重构

## 诊断（为什么现在像"假的颜色"）

1. **玻璃后面没有可折射的内容。** `.office-workbench-stage` 背景是 `--app-shell-main-bg`（浅色 `#ffffff` / 深色 `#101010`）纯色。`backdrop-filter: blur(46px)` 覆盖在纯白上只会得到"略不同的白"——玻璃无内容可折射。这是看起来假的根本原因。
2. **色调太不透明。** 当前"Liquid Glass pass"叠加了 `linear-gradient(white 46%)` + `linear-gradient(surface 18%)` + `surface-solid 42%` 三层，组合后接近不透明，`backdrop-filter` 的贡献被自身填色盖掉，读起来像磨砂塑料。
3. **假折射条纹。** `::after` 用 `repeating-linear-gradient` + `mix-blend-mode: screen` 画了条纹，是"画上去"的纹理，正是用户说的"假的颜色效果"。
4. **内层控件玻璃叠玻璃。** 按钮/输入框/行 又各自叠了一层 `blur(22px)` + 白色渐变，违反 §12"不要在半透明面上再叠半透明面"，导致层次发浑。

## 方案（用户已确认：柔和极光背景）

### 1. 给舞台加柔和极光 mesh 背景（最关键）
在 `.office-workbench-stage` 上用多点 `radial-gradient` 叠加一层低饱和度色光（蜜桃/天蓝/薰衣草），浅色模式下覆盖在白底之上。这是让 `backdrop-filter` 真正折射出色彩边缘的基底。深色模式换成更深沉的靛/青/梅色光。
- 卡片之间的间隙会露出这层背景（`check:workbench-card-separation` 测试用 `!important` 覆盖成纯蓝，不受影响）。
- 卡片悬浮其上，`backdrop-filter` 模糊这片色光 → 真玻璃。

### 2. 重写玻璃卡片材质（真正半透明）
作用于 `.workbench-room-switcher / .workbench-pomodoro-card / .workbench-task-card / .workbench-leaderboard-toggle / .workbench-leaderboard-panel / .workbench-space-join` 及浮层 `.office-workbench-stage > .workbench-leaderboard`：
- **背景**：单一极低不透明度色调（浅色 `rgba(255,255,255,0.10–0.16)`；深色 `rgba(255,255,255,0.06–0.10)`），让模糊后的极光透上来。
- **backdrop-filter**：`blur(30px) saturate(180%)`，去掉 `contrast()/brightness()`（这些是为假效果加的，多余且耗性能）。
- **高光边缘（specular rim）**：`box-shadow: inset 0 1px 0 rgba(255,255,255,0.7)` + 细白边 `border: 1px solid rgba(255,255,255,0.5)`。
- **单一柔和镜面反光**：保留 `::before`，改成一个左上角软径向高光、低不透明度（~0.5）。
- **删除**：`::after`（假折射条纹 + screen 混合）、`repeating-linear-gradient`、三层叠的白渐变。
- 保留投影做悬浮分离；保留排行榜面板入场 `materialize` 动画（§12"材质化而非淡入"）。

### 3. 轻量化内层控件（避免玻璃叠玻璃）
按钮/输入框/任务行/房间码框/计时环：去掉各自 `backdrop-filter` + 厚白渐变叠层，改为极淡色调 + 内嵌细边。计时环保留 `conic-gradient` 进度与柔光。文字保持 `--text` 高对比，确保可读（§12 vibrancy）。

### 4. 主题与可访问性
- 深色模式：极光更深沉、rim 更淡（`rgba(255,255,255,0.18~0.3)`）。
- 保留并补全 `@media (prefers-reduced-transparency: reduce)` 回退为 `--surface-solid` 实色、关 blur。
- 保留 `prefers-reduced-motion` 回退。

### 5. 不改动
- 所有尺寸/间距/字号/布局/命中区（`check:workbench-card-legibility` 验证：卡片不缩水、≥12px、不覆盖画布、不溢出轨道）。
- 番茄钟/任务/房间/榜单组件的 DOM 与逻辑（`.tsx` 不动）。
- 任务详情（schedule）页面本次不动——用户指明的是"自习室页面"。

## 改动文件
- `src/renderer/src/views/workbench/office-workbench.css`（唯一改动文件；重写 2142 行起的"Liquid Glass pass"及内层控件材质，新增舞台极光背景）

## 验证
1. `pnpm run check:workbench-card-separation` —— 间隙露出背景、右贴边、无灰桥
2. `pnpm run check:workbench-card-legibility` —— 字号≥12px、卡片不覆盖画布、不溢出
3. `pnpm run build` —— TS/构建通过
4. `pnpm run dev` 目检：卡片在极光上呈现真实折射，玻璃边缘有镜面高光，不再有画上去的条纹色块
