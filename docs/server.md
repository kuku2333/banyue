# 后端与账号系统

自建、零第三方依赖：Node 原生 `http` + `node:sqlite`（Node ≥ 22.5），没有 npm 包。

```bash
cd server
node src/index.mjs              # 默认 8787
PORT=9000 node src/index.mjs    # 换端口
BANYUE_DB=/path/db.sqlite node src/index.mjs
```

前端开发时 Vite 已把 `/api` 代理到 `127.0.0.1:8787`（见 `web/vite.config.ts`）。
生产环境同一个进程也能直接托管 `web/dist`（存在时自动启用，SPA 回退到 `index.html`）。

## 数据模型

| 表 | 说明 |
| --- | --- |
| `users` | 用户名、昵称、scrypt 密码哈希 + 盐 |
| `sessions` | 会话令牌，HttpOnly Cookie，30 天有效 |
| `collections` | 收藏夹：`type` 为 `music` / `books`，公开可读 |
| `collection_items` | 收藏夹条目：外键 + 标题/副标题快照 |
| `bookmarks` | 书签：书、章节、比例、留言，公开 |
| `song_comments` | 云端的歌曲评论 |
| `assets` | 云端文件：书 `book` / 音乐 `track`，落盘在 `server/data/files/` |

「本地的评论别人看不见」是这样实现的：本地书/本地音乐的评论只写在浏览器 IndexedDB，
永远不发请求；只有云端条目才会调用下面这些接口。

## 接口

除注册/登录外都返回 JSON，错误统一 `{ error: "..." }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | `{username, password, displayName}` |
| POST | `/api/auth/login` | `{username, password}` |
| POST | `/api/auth/logout` | 清 Cookie |
| GET | `/api/me` | 当前用户或 `null` |
| GET | `/api/collections?type=music\|books` | 公开列表，含创建者与条目数 |
| GET | `/api/collections/:id` | 详情（含条目） |
| POST | `/api/collections` | 需登录：`{type, name, description}` |
| DELETE | `/api/collections/:id` | 只有创建者 |
| POST | `/api/collections/:id/items` | 只有创建者：`{key, title, subtitle}` |
| DELETE | `/api/collections/:id/items/:itemId` | 只有创建者 |
| GET | `/api/books/:key/bookmarks` | 公开书签，带 `owner.displayName` |
| POST | `/api/books/:key/bookmarks` | 需登录：`{chapter, chapterTitle, ratio, note}` |
| DELETE | `/api/bookmarks/:id` | 只有作者 |
| GET | `/api/songs/:key/comments` | 公开评论 |
| POST | `/api/songs/:key/comments` | 需登录：`{body}` |
| DELETE | `/api/songs/:key/comments/:id` | 只有作者 |
| GET | `/api/assets?kind=book\|track` | 云端文件列表（公开，带上传者） |
| POST | `/api/assets?kind=book\|track` | 需登录：原始字节 + 头 `x-title` / `x-subtitle` / `x-filename` |
| GET | `/api/assets/:id/file` | 下载 / 流式播放，支持 Range |
| DELETE | `/api/assets/:id` | 只有上传者 |
| POST | `/api/auth/recover` | 恢复码重置密码：`{username, code, password}` |
| POST | `/api/auth/recovery-code` | 登录后重新生成恢复码 |

上传体积上限：书 20MB、音乐 40MB；**每个账号默认总共 200MB**（`BANYUE_QUOTA_MB` 可调），
超出返回 413 并提示剩余空间。文件落在 `server/data/files/`，数据库只存元信息；
`GET /api/storage` 返回当前账号的 `{ used, quota }`。

## 安全边界

- 密码用 `scrypt`（N=16384）加盐存储，不存明文；
- 会话是随机 24 字节令牌，Cookie 为 `HttpOnly; SameSite=Lax`，不暴露给前端 JS；
- 写操作全部校验登录态与归属（别人的收藏夹返回 403）；
- 请求体上限 64KB（JSON），上传另按类型限 20MB / 40MB；
- 同一个用户的自建部署里没有第三方登录、没有邮箱；
- **恢复码**在注册时显示一次（形如 `ABCD-EFGH-JKLM-NPQR`），只存 scrypt 哈希；
  忘记密码时用「用户名 + 恢复码 + 新密码」重置，成功后恢复码轮换、所有旧会话作废。
  恢复码丢了就只能改库——这是不接邮箱的代价。

## 测试

```bash
cd server && node --test test/api.test.mjs
```

测试会拉起一个临时数据库和随机端口的服务，覆盖注册登录、收藏夹权限、书签、评论。
