# Collis

> 一个插件，三样东西：**工作台模块视图**、**速记卡片**、**画布集**。启用这一个就够了。

[![Obsidian](https://img.shields.io/badge/Obsidian-1.13.0%2B-7c6df2)](https://obsidian.md)
[![Version](https://img.shields.io/badge/version-0.4.2-blue)](https://github.com/R529/Collis/releases)
[![Desktop only](https://img.shields.io/badge/platform-desktop-lightgrey)](#)

## 它能做什么

### 1. 工作台模块视图
把整个库按「模块」重新组织一遍，不搬动任何文件，只在 frontmatter 里写一个 `module` 字段。

- **首页**：每个模块一张卡片，显示笔记数量与最近更新。
- **收集箱（Inbox）**：还没写 `module` 的笔记，以及图片 / 视频 / PDF / 音频等附件，按修改时间倒序排好，等着归类。
- **模块页**：归属到该模块的笔记 + 模块文件夹里的素材附件，网格缩略图展示（图片真图、视频首帧、笔记正文片段）。
- **模块管理**：新建 / 编辑 / 排序 / 删除模块，自定义名称、图标、颜色、保存文件夹和筛选标签。删除模块只删筛选入口，**绝不删除笔记文件**。
- **智能建议**：收集箱里的笔记可按标签 / 文件夹名 / 文件名一键猜测模块，批量归入。

### 2. 速记卡片
不建文件、不起标题，想到就记。

- `Ctrl/Cmd + J` 弹出速记窗，`Ctrl/Cmd + Enter` 存一张，`Esc` 取消。
- 卡片按月存进本地 Markdown（默认 `00-Inbox/速记/YYYY-MM.md`），多行排版原样保留，末尾带块 ID 方便回链与嵌入。
- `Ctrl/Cmd + Shift + C` 把编辑器里选中的内容直接存成卡片。
- `Ctrl/Cmd + Shift + K` 在笔记里插入卡片（引用或全文）。
- 侧栏卡片视图：按月回看、标签管理与联想、父/子标签聚合、全文复制或复制块引用。

### 3. 画布集
把 Obsidian Canvas 升级成可思考的工作台。

- 画布卡片节点支持行内编辑、分组、带标签的语义连线（支持 / 反驳 / 导致 …）。
- 选中节点即可向 AI 提问，答案写回笔记（需自备模型服务商的 API Key，仅存本机）。
- 画布健康检查、Markdown 导出、撤销 / 重做（`Ctrl/Cmd + Z` / `Y`）。
- 画布存为 `.collis` 文件，与 Obsidian 原生 Canvas 共存。

## 安装

### 从社区插件市场（上架后）
设置 → 第三方插件 → 浏览 → 搜索 **Collis** → 安装并启用。

### 手动安装
1. 到 [Releases](https://github.com/R529/Collis/releases) 下载最新版的 `main.js`、`manifest.json`、`styles.css`。
2. 在你的库目录下创建文件夹 `.obsidian/plugins/collis/`，把三个文件放进去。
3. 设置 → 第三方插件 → 刷新 → 启用 **Collis**。

### 用 BRAT 安装
1. 安装 [BRAT](https://github.com/TfTHacker/obsidian42-brat)。
2. BRAT → Add Beta plugin → 填入 `R529/Collis` → Add Plugin。

## 命令与快捷键

| 命令 | 默认快捷键 | 说明 |
| --- | --- | --- |
| 打开 Collis | — | 打开工作台视图（左侧栏有图标） |
| 打开 Collis（专注模式） | — | 隐藏侧栏，沉浸浏览 |
| 切换 Collis 专注模式 | — | 开 / 关专注模式 |
| 切换 Collis 侧栏 | — | 折叠 / 展开左侧模块导航 |
| 打开卡片笔记 | — | 工作台 → 速记卡片页 |
| 快速记一条（Collis） | — | 工作台内唤起速记 |
| 打开 Collis 画布集 | — | 工作台 → 画布集页 |
| 快速记一条 | `Ctrl/Cmd + J` | 任意位置弹速记窗 |
| 把选中的内容存为卡片 | `Ctrl/Cmd + Shift + C` | 编辑器选区存卡 |
| 插入卡片（引用或全文） | `Ctrl/Cmd + Shift + K` | 在笔记里插入已有卡片 |
| 打开卡片视图 | — | 打开速记卡片侧栏视图 |

> 所有快捷键都可在 设置 → 快捷键 里搜索 `Collis` 自行修改。

## 本地构建与开发

```bash
# 1. 准备 esbuild（任选其一）
npm install --save-dev esbuild
# 或指定已有 esbuild 可执行文件：ESBUILD=/path/to/esbuild

# 2. 打包（生成 dist/main.js、dist/styles.css、dist/manifest.json、dist/versions.json）
node build/build.js

# 3. 本地验证（不启动 Obsidian，仅校验 bundle 能加载）
node build/verify.js
```

把 `dist/` 里的三个文件拷到 `.obsidian/plugins/collis/` 即可在 Obsidian 里加载测试。

### 目录结构

```
Collis/
├── dist/                # 构建产物（发布到 Release 的三个文件在这里）
│   ├── main.js
│   ├── manifest.json
│   ├── styles.css
│   └── versions.json
├── src/                 # 工作台宿主源码
│   ├── main.js
│   ├── collis-gallery.js
│   └── collis-notes.js
├── vendor/              # 内置的速记卡片 / 画布集模块（打包时并入）
│   ├── collis-core.js
│   └── collis-board-core.js
├── build/               # 构建与验证脚本、分段样式
└── manifest.json (in dist)
```

## 说明

- 所有数据都存在你的本地库里，不上传任何服务器。
- AI 功能（画布集）的 API Key 仅保存在本机插件配置中。
- 本插件为桌面端专用（`isDesktopOnly: true`）。

## License

MIT © Lak
