# 部署与托管方案

> **当前决定（2026-10-21）**：不走 Cloudflare Pages —— 本机访问该平台不稳定。
> 先只做本地验证，等自有服务器就绪后**自建部署**（§5 有可直接抄的配置）。
> 下面的平台对比保留作为备选参考。

## 0. 自建部署（当前路线）

```bash
# web/ 下构建
pnpm install && pnpm build        # 产物在 web/dist

# 推到服务器（nginx 静态目录）
rsync -avz --delete web/dist/ user@server:/var/www/banyue/

# 服务器上：Caddy 两行搞定 HTTPS
# /etc/caddy/Caddyfile
# banyue.example.com {
#     root * /var/www/banyue
#     try_files {path} /index.html   # SPA 回退
#     file_server
# }
```

nginx 等价配置：

```nginx
server {
    listen 443 ssl http2;
    server_name banyue.example.com;

    root /var/www/banyue;
    index index.html;

    # SPA 路由：找不到文件时回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 带 hash 的静态资源可以长缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

要点：

- `web/dist` 是纯静态文件，**不需要 Node 运行时**；
- SPA 回退必须配（`try_files` / `try_files {path} /index.html`），否则刷新 `/post/xxx` 会 404；
- `vite build` 已经把 `_redirects`、`404.html` 一起生成，托管方支持哪个用哪个；
- 本地验证等价于线上：`pnpm build && pnpm preview` 起的就是最终产物；
- 媒体文件（书、音乐）不上传服务器，只存在读者浏览器里，服务器只发静态文件。

## 1. 为什么必须有一个账号（备选方案的前提）

「永久在线 + 任何设备可访问」= 必须有一台一直在线的机器 + 一个域名。免费的方案无一例外由平台提供，
平台就需要一个归属账号（否则谁都能往你的站点写内容）。这是现实边界，不是产品选择：

- **访问者**：不需要登录。静态站没有账号体系，打开即用 —— 这一点 v1 本来就是对的。
- **发布者（你）**：需要一个账号来「认领」这个站点。但可以做到**之后再也不打开它的后台**：
  代码推到 GitHub，Cloudflare Pages 自动构建部署，全程不再登录任何第三方服务。
- **真正零账号**只有自建：一台 VPS + 自己的域名（见 §5），代价是钱和运维。

`workbuddy` 那种「必须登录它的账号才能上传」的痛点，本质是把**内容**存在了平台的数据库里。
v2 把内容放回 Git（纯文本、可迁移、可 diff），平台只负责把静态文件发出去，随时可以换。

## 2. 免费额度对比（2026-10 核对）

| 平台 | 免费额度 | 带宽 | 构建 | 账号 | 备注 |
| --- | --- | --- | --- | --- | --- |
| **Cloudflare Pages** | 单站 20,000 个文件、单文件 25 MiB、100 个自定义域名 | 不限 | 500 次/月，每次 20 分钟超时 | Cloudflare | 每个分支/PR 自动生成预览 URL |
| **GitHub Pages** | 单站 1 GB | 软限 100 GB/月 | 10 次/小时（软限，用 Actions 自建流程不受限） | GitHub | 公开仓库免费；`*.github.io` 自带 HTTPS |
| Netlify | 100 GB/月带宽、300 分钟构建 | 100 GB/月 | 300 分钟/月 | Netlify | 免费版够个人站，但构建分钟数要算 |
| Vercel Hobby | 100 GB/月带宽 | 100 GB/月 | 有并发限制 | Vercel | 商用条款要注意 |
| **Cloudflare Drop** | 拖拽即用，**无需注册** | — | — | **无** | URL 只活 **1 小时**，适合临时给朋友看，不能当长期站 |
| 自建 VPS | 硬盘多少都行 | 看带宽 | 自己搭 | 自己 | ¥100–300/年 + 域名 ¥30–60/年 |

数据来源：Cloudflare Pages 限额、GitHub Pages 限额、R2 定价（见文末链接）。

**为什么不用 Cloudflare Drop 当长期方案**：它确实零账号，但产物一小时后自动删除，且不提供自定义域名。
它的正确用法是「大改动的临时预览」，而 `pnpm preview` 本地就能做到，所以不纳入主流程。

## 3. 备选架构：GitHub + Cloudflare Pages（暂不采用）

```
本地开发 (pnpm dev)  ──►  本地验证 (test / build / preview)
        │
        └─ git push origin main
                 │
                 ▼
     GitHub Actions  build (web/)  ──►  Cloudflare Pages 部署
                 │                              │
                 └─ PR 分支 ──► 预览 URL        └─ 生产：https://banyue.pages.dev
```

- **小改动**：本地 `pnpm dev` 看效果 + `pnpm test` + `pnpm build && pnpm preview`，不部署。
- **大改动**：推分支 → PR → 自动生成预览 URL → 确认后合并到 `main` → 自动上线。
- **访客**：任何设备打开同一个域名，无需登录、无需注册。

## 4. 备选方案的一次性配置（约 10 分钟）

1. **建仓库**：GitHub 新建 `banyue`（公开或私有都行），`git remote add origin` 后 push。
2. **连 Cloudflare Pages**：Cloudflare 控制台 → Workers & Pages → Create → Pages → Connect to Git →
   选仓库 → 构建配置：
   - Build command：`pnpm install && pnpm build`
   - Build output directory：`web/dist`
   - Root directory：`web`（若控制台选项里要用相对路径，填 `web`）
   - 环境变量：`NODE_VERSION=22`
3. **自定义域名（可选）**：Pages → Custom domains → 绑定你的域名，HTTPS 自动签发。
4. 之后每次 `git push origin main` 自动部署，**不用再登录**。

> 不想用 Cloudflare 账号的话，`.github/workflows/deploy-pages.yml` 是 GitHub Pages 版本，
> 不需要任何密钥，只要在仓库 Settings → Pages 里把 Source 选成 "GitHub Actions"。

## 5. 自建方案（如果哪天不想依赖任何平台）

- 最省事：`rsync -avz web/dist/ user@host:/var/www/banyue` + Caddy/nginx 静态目录；
- 12 美元的 VPS 一年约 ¥100–300 能跑，域名 ¥30–60/年；
- 代价：证书续期、备份、被墙风险、系统升级都要自己管。

对比：个人博客的流量一个月通常不到 1 GB，Cloudflare Pages 的免费额度几乎不可能用完，
所以「自建」只在「需要后端」时才值得考虑（见下）。

## 6. 数据放哪：读者不需要账号，作者也不需要

| 数据 | 存哪 | 跨设备 |
| --- | --- | --- |
| 文章 | Git 里的 Markdown | 自动（随代码） |
| 阅读位置、字号、主题 | `localStorage` | 否（设备各自记忆） |
| 书架（TXT/MD）、本地音乐 | IndexedDB | 否，可用「导出/导入」迁移 |
| 写作台草稿 | 第一阶段只做本地草稿 | 否 |

v2 明确**不设账号体系**。需要跨设备同步时，提供一条「自带存储」的路径：

- **方案 A（默认，零后端）**：导出/导入 JSON 或 zip。最简单，任何设备可用。
- **方案 B（可选，一次粘贴一个令牌）**：Cloudflare Worker + R2。
  免费额度：**10 GB 存储 / 每月 100 万次写入 / 1000 万次读取 / 出站流量免费**。
  页面里没有登录框，只有设置页的一个「同步令牌」输入框；令牌只存在你的浏览器里。
  缺点：谁拿到令牌谁就能写，所以令牌等同于密码，不要公开。
- **方案 C（自建）**：自己的服务器 + WebDAV/S3 兼容存储，最自由，成本最高。

第一阶段（当前）只做 A；B 作为独立模块，等博客稳定后再加，避免把「重新绑定一个后端」变成新的负担。

## 7. 参考链接

- Cloudflare Pages 限额：<https://developers.cloudflare.com/pages/platform/limits/>
- GitHub Pages 限额：<https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>
- Cloudflare R2 价格与免费额度：<https://developers.cloudflare.com/r2/pricing/>
- Cloudflare Drop（免账号、1 小时临时站）：<https://www.cloudflare.com/drop/>
