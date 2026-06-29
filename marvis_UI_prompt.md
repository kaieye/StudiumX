从这张界面来看，它属于目前比较流行的 **Neo Minimal（新极简）+ Soft UI（轻拟态）+ AI Native Dashboard** 的设计风格，整体偏向 **Notion、Raycast、Linear、Arc Browser、OpenAI Desktop** 那一类产品的视觉语言。

下面是一份比较专业的 UI 风格描述，可直接作为设计规范或者 AI Prompt。

------

# UI Style Description（英文版）

## Overall Style

A clean, modern AI-native desktop interface with a minimalist aesthetic. The design emphasizes whitespace, soft rounded corners, subtle shadows, and neutral grayscale tones. The overall feeling is calm, premium, lightweight, and highly readable.

The interface follows a card-based layout with generous spacing, creating an elegant productivity-oriented workspace similar to Notion, Linear, Arc Browser, ChatGPT Desktop, and Raycast.

------

## Visual Characteristics

### Color Palette

- Pure white background (#FFFFFF)
- Very light gray surfaces (#F7F7F7 ~ #FAFAFA)
- Neutral grayscale typography
- Almost no saturated colors
- Accent colors only appear inside icons or illustrations
- Black is reserved for titles and primary actions

Overall contrast is soft instead of harsh.

------

### Typography

Modern sans-serif font.

Characteristics:

- Large bold headings
- Medium-weight navigation
- Light gray secondary descriptions
- Comfortable line spacing
- Strong hierarchy

Typical sizes:

- H1: 48–56px
- Section Title: 22–28px
- Navigation: 15–16px
- Body: 14–15px
- Caption: 12–13px

------

### Corners

Large rounded radius throughout.

Typical values:

- Cards: 20–24px
- Buttons: 16–20px
- Input box: 24–30px
- Sidebar: 24px

No sharp edges.

------

### Shadows

Very soft elevation.

Characteristics:

- Low opacity
- Large blur radius
- Almost invisible
- Creates floating effect

Example:

```
0 6px 20px rgba(0,0,0,0.04)
```

No heavy Material Design shadows.

------

### Layout

Desktop-first layout.

Structure:

```
┌──────── Sidebar ────────┐
│                         │
│                         │
│                         │
├─────────────────────────┤
│                         │
│     Main Workspace      │
│                         │
│                         │
└─────────────────────────┘
```

Features:

- Fixed left sidebar
- Center-aligned content
- Large margins
- Plenty of whitespace
- Modular card layout

------

### Components

#### Sidebar

- White background
- Rounded outer container
- Minimal monochrome icons
- Simple hover feedback
- No visible borders

------

#### Search Box

Large rounded rectangle

- Soft border
- Light gray placeholder
- Embedded search icon
- No heavy outline

------

#### Chat Input

Large rounded container

Approximately:

- Height: 180–220px
- Border only
- White background
- Large breathing space
- Upload button inside
- Send button floating at bottom-right

Feels more like ChatGPT Desktop than traditional messaging apps.

------

#### Cards

Cards are the primary information units.

Features:

- White background
- Rounded corners (20px)
- Very subtle border
- Tiny shadow
- Spacious padding
- Minimal decoration

------

### Icons

Monochrome outline icons.

Characteristics:

- Thin stroke
- Uniform weight
- Small size
- Rounded appearance

Accent icons may use:

- Blue
- Red
- Orange

Only for semantic emphasis.

------

### Interaction

Hover:

- Slight background tint
- Slight elevation
- Smooth transition

Click:

- Gentle scale
- Soft shadow

Animation:

- 150–250ms
- Ease-out
- Very restrained

------

### Design Keywords

Minimalism

Soft UI

AI Native

Productivity

Desktop App

Card-based

Large Whitespace

Rounded Corners

Premium

Elegant

Calm

Professional

Modern SaaS

Apple-inspired

Linear-inspired

Notion-inspired

ChatGPT Desktop-inspired

------

# 中文风格描述

## 整体风格

整体采用 **AI Native 极简生产力风格**，融合 **Neo Minimal（新极简）** 与 **Soft UI（轻拟态）** 的设计理念，强调留白、圆角、柔和阴影和卡片式布局，视觉体验轻盈、安静且具有高级感。

界面整体偏向 **Apple Human Interface Guidelines** 的设计语言，同时融合 **Notion、Linear、Raycast、Arc Browser、ChatGPT Desktop** 等现代 AI 产品的视觉特征。

------

## 设计关键词

- AI Native
- Neo Minimal
- Soft UI
- Apple 风格
- 北欧极简
- 大留白
- 卡片式布局
- 高级灰配色
- 柔和圆角
- 低对比阴影
- 中性色设计
- Productivity Dashboard
- Desktop First
- Calm Interface
- Premium SaaS
- Floating Cards
- Elegant Workspace
- Modern AI Assistant
- Clean Typography
- Generous Spacing

------

# 一句话总结

> **一种融合 Apple 极简美学、Notion 的留白布局、Linear 的精致细节、ChatGPT Desktop 的 AI Native 交互以及 Soft UI 柔和视觉语言的现代桌面 AI 助手界面设计风格。**

如果你打算让 AI（如 Midjourney、Figma AI、v0、Lovable、Cursor 等）生成同类型 UI，可以直接使用下面这段 Prompt：

> **Modern AI-native desktop application UI, Apple-inspired minimalism, Soft UI, Neo Minimal style, ultra clean interface, large whitespace, floating rounded cards, subtle shadows, neutral grayscale palette, premium SaaS dashboard, ChatGPT desktop aesthetic, Notion-inspired layout, Linear-inspired typography, elegant productivity workspace, 24px rounded corners, glass-free, high readability, desktop-first, clean card system, minimal monochrome icons, refined spacing, luxury minimal design.**