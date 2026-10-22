# 后端与账号系统

自建、零第三方依赖：Node 原生 `http` + `node:sqlite`（Node ≥ 22.5），没有 npm 包。

```bash
cd server
node src/index.mjs              # 默认 8787
PORT=9000 node src/index.mjs    # 换端口
BANYUE_DB=/path/db.sqlite node src/index.mjs
BANYUE_FILES_DIR=/path/files node src/index.mjs   # 上传文件目录（默认 server/data/files）
```

环境变量：`PORT`（端口）、`BANYUE_DB`（数据库路径）、`BANYUE_FILES_DIR`（上传文件目录）、
`BANYUE_QUOTA_MB`（每账号容量）、`BANYUE_ADMINS`（管理员用户名，逗号分隔）。

## 内置管理员账号

服务启动时会自动确保一个内置管理员存在（默认 `ttbvb` / `123456`），**任何部署实例启动后都能用它登录**，
且该账号始终是管理员；已存在时每次启动会把密码重置回内置值（内置账号语义，保证到处可登）。

可用环境变量覆盖：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `BANYUE_BUILTIN_USER` | `ttbvb` | 内置账号用户名 |
| `BANYUE_BUILTIN_PASS` | `123456` | 内置账号密码 |
| `BANYUE_BUILTIN_NAME` | `管理员` | 显示昵称 |

> ⚠️ **安全警告**：内置密码随代码仓库分发，公网部署时请务必用 `BANYUE_BUILTIN_PASS`
> 设置为强密码（systemd 服务里加一行 Environment 即可），否则任何访问者都能用默认密码登录管理员。

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
| POST | `/api/assets?kind=book\|track` | 需登录：原始字节 + 头 `x-title` / `x-subtitle` / `x-filename` / 可选 `x-hash`（内容指纹） |
| GET | `/api/assets/:id/file` | 下载 / 流式播放，支持 Range |
| DELETE | `/api/assets/:id` | 只有上传者（管理员可删任意） |
| POST | `/api/auth/recover` | 恢复码重置密码：`{username, code, password}` |
| POST | `/api/auth/recovery-code` | 登录后重新生成恢复码 |
| GET | `/api/hidden-posts` | 被管理员隐藏的文章 slug 列表（公开） |
| POST | `/api/posts/:slug/hide` | 需管理员：隐藏文章 |
| DELETE | `/api/posts/:slug/hide` | 需管理员：恢复文章 |

上传体积上限：书 50MB、音乐 40MB；**每个账号默认总共 200MB**（`BANYUE_QUOTA_MB` 可调），
超出返回 413 并提示剩余空间。文件落在 `server/data/files/`，数据库只存元信息；
`GET /api/storage` 返回当前账号的 `{ used, quota }`。

**内容指纹去重**：上传时带 `x-hash`（本地音乐导入算好的 SHA-256 前 16 位），
同一账号重复上传同一指纹会返回 `200 { duplicate: true, id }`，不落盘、不占配额。
「一键同步」靠它跳过云端已有的文件；无指纹的旧数据不参与判重。

**服务端兜底**：客户端不传 `x-hash` 时，服务端读刚落盘的文件自己算一份指纹并回填，
所以「老客户端 / 旧数据 / 漏传 hash」都不会漏判；落盘后的二次查重能拦住并发与绕过。

**旧数据迁移**：`node scripts/backfill-hash.mjs` 会给所有无指纹资产回填指纹、按
`(owner, kind, hash)` 删重复（保留最早一条）、清理磁盘孤儿文件（如测试残留的 `.html`）。可重复执行。

## 管理员

```bash
node scripts/grant-admin.mjs <username>          # 设为管理员
node scripts/grant-admin.mjs <username> --revoke  # 取消
# 或者启动时：BANYUE_ADMINS=alice,bob node src/index.mjs
```

- 权限：删除任意云端文件、收藏夹、书签、评论；隐藏/恢复文章。
- 文章是静态文件，「删除」= 服务端写一条 `hidden_posts`，前端据此过滤，可恢复。
- 前端表现：头部用户名旁「管理员」徽章；文章页出现「删除文章 / 恢复文章」；
  云端列表、评论、书签的删除按钮对管理员开放。
- 隐藏列表由 `GET /api/hidden-posts` 公开返回，所以访客也不会看到被删文章。

## 安全边界

- 密码用 `scrypt`（N=16384）加盐存储，不存明文；
- 会话是随机 24 字节令牌，Cookie 为 `HttpOnly; SameSite=Lax`，不暴露给前端 JS；
- 写操作全部校验登录态与归属（别人的收藏夹返回 403）；
- 请求体上限 64KB（JSON），上传另按类型限 50MB / 40MB，缺 `Content-Length` 时边写边计数，
  落盘后再按实际用量复核一次配额（并发上传不会一起冲过 200MB）；
- 上传的 MIME 会被归一：书只存 `text/plain` / `text/markdown`，音乐只存 `audio/*`，
  其余按 `application/octet-stream` 处理；下载时带 `X-Content-Type-Options: nosniff`，
  非音频文件强制 `Content-Disposition: attachment`——否则别人可以上传 HTML/SVG 在本站域名下执行脚本；
- `Range` 支持 `bytes=a-b` / `bytes=a-` / `bytes=-n`，越界返回 `416`；
- 路径先做安全解码：`/%`、`/%zz` 这类畸形转义返回 400，不会把进程带下去；
  静态资源按白名单后缀解析，缺失的 `.js` / `.css` 返回 404，不会被回退成 `index.html`；
- 登录与恢复码重置换密码按「用户名 + 来源 IP」限流：10 分钟内错 10 次返回 `429`，
  成功登录（或成功重置）后清零；
- 同一个用户的自建部署里没有第三方登录、没有邮箱；
- **恢复码**在注册时显示一次（形如 `ABCD-EFGH-JKLM-NPQR`），只存 scrypt 哈希；
  忘记密码时用「用户名 + 恢复码 + 新密码」重置，成功后恢复码轮换、所有旧会话作废。
  恢复码丢了就只能改库——这是不接邮箱的代价。

## 测试

```bash
cd server && node --test test/api.test.mjs
```

测试会拉起一个临时数据库和随机端口的服务，覆盖注册登录、收藏夹权限、书签、评论、
云端配额与 Range 下载、上传 MIME 白名单，以及畸形 URL 不会打挂进程。
