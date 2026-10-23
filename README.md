# 半月 · banyue

一个人的站点：博客、书架、听歌台、写作台。v2 用 Vue 3 重写，替代 v1 的单文件版本。

```
blog/
├── web/                  # 前端（Vue 3 + Vite + TypeScript）
│   ├── src/
│   │   ├── components/   # 布局与复用组件
│   │   ├── views/        # 路由页面
│   │   ├── lib/          # Markdown 渲染、内容聚合、接口封装
│   │   ├── stores/       # Pinia 状态
│   │   └── content/posts # 文章（Markdown + frontmatter）
│   ├── tests/            # Vitest 单测
│   └── public/
├── server/               # 自建后端（Node 原生 http + node:sqlite，无第三方依赖）
│   ├── src/              # db / auth / 路由
│   └── test/             # node:test 接口测试
├── legacy/banyue-blog/   # v1.1 单文件版本（归档，不再修改）
├── releases/             # 发布快照（zip）
├── docs/                 # 架构决策、部署手册、后端说明
└── .github/workflows/    # CI：构建 + 部署
```

## 快速开始

```bash
cd web
pnpm install
pnpm dev          # http://localhost:5173
```

账号、收藏夹、书签、评论需要后端（可选）：另开一个终端

```bash
cd server
node src/index.mjs        # http://localhost:8787，前端 /api 已代理到它
node --test test/api.test.mjs   # 接口测试
```

提交前至少跑：

```bash
pnpm typecheck    # vue-tsc
pnpm test         # vitest
pnpm build        # 产出 dist/
pnpm preview      # 本地预览构建产物
```

## 写文章

在 `web/src/content/posts/` 新建 `<slug>.md`，文件名就是 URL 里的 slug：

```markdown
---
title: "标题"
excerpt: "列表页的一句话摘要"
date: 2026-10-21
read: 8
tags: ["城市漫游", "生活观察"]
featured: false
---

## 第一节
正文用 Markdown 写。
```

保存后 `pnpm dev` 会热更新；构建时自动生成列表、标签、归档与搜索索引。

## 约定

- **内容与代码分离**：文章是 Markdown，页面是组件，不把正文写进 `.vue`。
- **没有登录、没有第三方 SDK**：读者打开就能用；本地数据只存在浏览器里。
- **纯静态产物**：`pnpm build` 出 `dist/`，丢到任何静态托管都能跑，不需要 Node 服务器。
- **提交信息**用 Conventional Commits（`feat:` / `fix:` / `docs:` / `chore:`）。
- **v1 只读**：`legacy/` 下的文件除紧急修复外不动。

## 路线图

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 博客：首页 / 文章 / 标签 / 归档 / 关于 / 搜索 | 已完成 |
| 2 | 书架与阅读器（IndexedDB、分章、四种主题、左右对开 3D 翻书、进度记忆） | 已完成 |
| 3 | 听歌台（Apple Music 榜单、本地音乐、收藏、队列、律动频谱、可拖拽播放器） | 已完成 |
| 4 | 写作台（本地草稿、Markdown 预览、自动保存、导出 .md） | 已完成 |
| 5 | 账号系统 + 收藏夹（自建后端、公开可见、带用户名） | 已完成 |
| 6 | 书签与评论（公开书签带留言、云端歌评论、本地评论仅本机） | 已完成 |
| 7 | 云端存储（书 / 音乐上传下载、Range 流式播放、恢复码） | 已完成 |
| 8 | 部署：自建服务器（nginx/Caddy + rsync） | 待开始 |

详见 [docs/deploy.md](docs/deploy.md) 与 [docs/adr](docs/adr/)。
