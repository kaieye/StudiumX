这张界面整体属于近年来比较流行的 **Neo Minimalism（新极简主义）+ Soft UI（轻拟物）+ Apple Human Interface 风格**，同时融合了 **Linear / Arc / Raycast / Notion Calendar** 等现代 AI 产品的设计语言。

如果要用于 AI 绘图、UI Prompt 或设计规范，可以描述为下面这种风格。

------

# UI Style Description（完整版）

**Style:** Modern AI SaaS Dashboard / Neo Minimalism / Soft Glassmorphism / Apple-inspired Interface

### 整体风格（Overall Style）

一种现代 AI SaaS 产品风格，极简主义设计，拥有大量留白（Whitespace），柔和的浅色背景，低对比度配色，轻拟物（Soft UI）阴影，以及微玻璃拟态（Subtle Glassmorphism）。

整个界面强调：

- Calm
- Clean
- Lightweight
- Elegant
- Premium
- Productivity-first

类似于：

- ChatGPT Desktop
- Arc Browser
- Linear
- Raycast
- Vercel Dashboard
- Apple macOS Apps

------

# 配色（Color Palette）

整体几乎都是低饱和颜色。

背景：

```
#FAFBFD
#F8F9FC
#F5F7FB
```

Primary：

```
#4F7CF5
```

Secondary：

```
#8EA6D9
```

文字：

```
Primary
#24324A

Secondary
#68778F

Disabled
#A7B1C2
```

Border：

```
#E9EDF4
```

Hover：

```
#F4F6FA
```

几乎没有高饱和颜色。

------

# 光影（Lighting）

非常轻。

Shadow：

```
0 6px 20px rgba(20,30,50,.05)

或者

0 10px 40px rgba(0,0,0,.04)
```

特点：

- Shadow 很大
- Blur 很高
- Alpha 很低

不是 Material Design 那种厚重阴影。

------

# 圆角（Border Radius）

几乎全部采用统一圆角。

推荐：

```
Card

20~28px

Button

10~14px

Input

14~18px

Sidebar

20px
```

属于 Apple 风格的大圆角。

------

# 边框（Borders）

全部都是：

```
1px solid rgba(100,120,150,.12)
```

非常淡。

几乎看不到。

------

# 布局（Layout）

采用现代 Dashboard Layout。

```
┌────────────┬──────────────────────┐
│            │                      │
│ Sidebar    │     Main Content     │
│            │                      │
│            │                      │
└────────────┴──────────────────────┘
```

特点：

左侧

固定 Sidebar

右侧

大量留白

内容居中

视觉重心靠中间

------

# 留白（Whitespace）

这是最大的特点。

所有元素之间距离都很大。

例如：

```
24px

32px

40px

48px

64px
```

几乎没有紧凑布局。

整个页面十分"透气"。

------

# Typography

字体：

```
SF Pro Display

Inter

HarmonyOS Sans

MiSans
```

字重：

```
Title

700

Subtitle

500

Body

400
```

字号：

```
Title

40

H2

28

Body

15

Caption

13
```

整体偏 Apple。

------

# 图标（Icons）

使用：

Outline Icon

例如：

```
Lucide

Phosphor

Remix Icon

Heroicons
```

特点：

2px Stroke

圆角

细线

统一大小

------

# Button Style

Primary Button：

浅蓝背景

```
#EDF4FF
```

蓝色文字：

```
#4E7AF3
```

Hover：

```
#E4EEFF
```

没有厚重阴影。

Secondary：

只有 Border。

Ghost Button：

透明背景。

------

# Input Style

输入框：

超大圆角。

```
radius

16px
```

内部 Padding：

```
18px
```

Border：

```
#EAEFF5
```

Hover：

```
#DDE5F2
```

Focus：

浅蓝描边。

------

# Card Style

所有 Card：

```
Background

White

Radius

24px

Border

1px solid #EEF2F7

Shadow

0 8px 30px rgba(0,0,0,.04)
```

几乎像漂浮在背景上一样。

------

# Glass Effect

不是传统 Glassmorphism。

属于：

Subtle Glass。

例如：

```
backdrop-filter:
blur(20px);

background:

rgba(255,255,255,.75)
```

透明度很低。

------

# 插画（Illustration）

Illustration：

蓝白渐变。

极简矢量。

线稿风格。

圆润。

偏 Lottie 风格。

很像：

Microsoft Fluent Illustration

Apple Illustration

Linear Illustration

------

# 动效（Motion）

如果补全交互的话：

Hover：

```
transition:

250ms ease
```

Scale：

```
1

↓

1.02
```

Shadow：

轻微增加。

Button：

Background Fade。

Sidebar：

Smooth Expand。

整体属于：

Delight Motion。

------

# 可以概括成一句 Prompt

> **A premium AI SaaS dashboard UI with Neo-Minimalism, Apple-inspired Human Interface, Soft UI, subtle Glassmorphism, spacious whitespace, rounded cards, low-contrast pastel palette, thin outline icons, elegant typography, floating panels, clean productivity-focused layout, modern desktop application aesthetic, inspired by Linear, Arc Browser, Raycast, ChatGPT Desktop, and Vercel.**

------

## 关键词（适合用于 AI 绘图 / UI 生成）

```text
Neo Minimalism
Apple Human Interface
Soft UI
Soft Glassmorphism
Modern SaaS Dashboard
AI Workspace
Clean Desktop App
Linear.app Style
Arc Browser Style
Raycast UI
ChatGPT Desktop Style
Vercel Dashboard
Large Whitespace
Rounded Cards
Thin Outline Icons
Pastel Blue Accent
Low Contrast
Premium Interface
Floating Panels
Elegant Typography
Calm Design
Productivity UI
Subtle Shadow
Minimal Dashboard
MacOS Inspired
```

**一句话总结：** 这是一种以 **Apple Human Interface 为基础**，融合 **Neo Minimalism、Soft UI、轻量 Glassmorphism** 和 **现代 AI SaaS 产品设计语言** 的界面风格。它通过低饱和配色、大量留白、大圆角、极轻阴影和精致线性图标，营造出专业、安静、高级且具有未来感的 AI 桌面应用体验。