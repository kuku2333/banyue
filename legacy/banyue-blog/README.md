# 半页 · 个人站点

> 一个文件装下博客、小说阅读器、听歌台和写作台。
> 全部 HTML / CSS / JS / SVG 内联在 `blog.html` 里，没有构建步骤，没有 npm 依赖，没有外部框架。

- 源码：`blog.html`（约 259k 字符 / 273 KB）
- 版本：v1.1（2026-10-21）
- 运行时依赖：无（唯一的网络请求是 Apple 公开试听接口和平台提供的存储 SDK）

---

## 1. 功能清单

### 博客

- 首页：Hero 区（文章数/标签数/字数/年数）、本期精选、主题筛选胶囊、时间倒序列表、程序化 SVG 封面
- 文章详情：阅读进度条、右侧目录（h2/h3 两级，滚动高亮）、上下篇、相关推荐（按标签重合度算）
- 阅读辅助：字号三档、行距两档、代码块一键复制、阅读位置记忆（下次进来提示「上次读到 68%」）
- 标签页：12 个标签卡片墙 + 单标签聚合
- 归档页：按年/月分组的时间轴
- 关于页：作者自述、写作时间线、书单、联系方式
- 全局搜索：标题/摘要/正文/标签，支持键盘操作
- Markdown：自写解析器，支持标题、粗体、斜体、行内代码、代码块、引用、列表、表格、分割线、链接

### 书架与阅读器

- 上传 TXT / Markdown（多选、拖拽），自动识别 UTF-8 / GBK
- 自动分章（第 X 章 / 卷 / 回 / 序章 / 楔子 / 番外），识别不到按 3000 字切节
- 自动清理文件开头的「书名：」「作者：」和重复章节标题
- 沉浸阅读：宋体正文、首行缩进、章节标题居中；四种主题（墨/纸/护/夜）
- 两种翻页：上下滚动、左右跨页翻书（3D 纸张翻转、跟手拖拽、跨章衔接）
- 可调字号、行距、版心宽度；退出记住位置
- 目录抽屉、进度条跳转、快捷键（← → 空格 Esc）、点击中部收起工具栏
- 阅读时右下角有迷你播放器（律动环 + 暂停），点开可切歌

### 听歌

- 五个榜单标签：华语 / 欧美 / 日本（Apple Music 实时 Top 10）、B站（音乐区 Top 10 快照）、抖音（无公开接口，给直达入口）
- 搜索：歌名/歌手，30 秒试听，可切区
- 播放器：可拖动到任意位置、点封面折叠成胶囊、环形频谱律动、可拖拽进度条（带时间气泡）
- 收藏库：星标收藏、播放全部，队列顺序为 收藏 → 本地 → 云端，一首播完自动接下一首
- 我的音乐（本机）：批量导入（多选 / 拖拽 / 整文件夹）、指纹去重、保存成文件到本机
- 云端音乐：批量上传、SHA-256 指纹去重、补全指纹、下载入库、保存到本机、删除
- 播放器跨页面常驻（写博客、看小说时都能听）

### 写作台

- 云端笔记/文章，左侧列表 + 右侧编辑，支持 Markdown 预览
- 停手 2 秒自动保存，`Ctrl/Cmd + S` 手动保存
- 15 秒轮询 + 切回标签页刷新；被另一端修改时自动载入
- 保存的内容会出现在首页「最近写的」，可点开成文章页

### 系统能力

- 单文件，零 CDN、零字体、零图片请求（封面是运行时生成的 SVG）
- 桌面双栏 / 平板单列 / 手机底部 Tab，按钮 ≥44px，输入框 16px 防 iOS 缩放
- 云端能力可降级：没有存储 SDK 时，本地功能照常，写作台改写 localStorage，云端区提示未登录

---

## 2. 快速开始

```bash
cd banyue-blog

./tools/serve.sh          # 等价于 python3 -m http.server 8000
# 打开 http://localhost:8000/blog.html
```

> **别用 `file://` 直接双击打开。**
> 阅读器的 IndexedDB、音乐指纹的 `crypto.subtle` 都要求安全上下文，`file://` 下会部分失效。
> 任意静态服务器都可以（nginx、Caddy、Vercel、对象存储静态托管）。

提交前跑一遍自检：

```bash
./tools/check.sh
# 提取内联脚本 -> node --check
# 检查是否混入了外部 <script src> / <link stylesheet>
```

---

## 3. 目录结构

```
banyue-blog/
├── blog.html            # 全部源码，唯一需要编辑的文件
├── README.md            # 本文档
├── CHANGELOG.md         # 版本记录
├── docs/
│   ├── sdk-contract.md  # 后端接口契约（迁移 / 自建后端时看这个）
│   └── schema.json      # 三张数据表的字段定义
└── tools/
    ├── extract_js.py    # 把内联 <script> 抽成 build/inline.js
    ├── check.sh         # 语法 + 零外链自检
    └── serve.sh         # 一键本地服务
```

---

## 4. 代码地图

`blog.html` 内部按编号分区，搜索注释标题即可定位：

| 区 | 模块 | 关键函数 |
| --- | --- | --- |
| 1 | 数据层 | `POSTS`（内置 6 篇文章）、`state` |
| 2 | 工具函数 | `escapeHtml`、`fmtDate`、`hashCode`、`wordCount` |
| 3 | Markdown 渲染 | `mdToHtml`（零依赖，只输出白名单标签） |
| 4 | 公共片段 | `postItemHtml`、`coverSvg`、`setActiveNav` |
| 5 | 首页 | `renderHome` |
| 5.5 | 云端笔记 | `fetchCloudPosts`、`loadCloudNotes` |
| 5.6 | 云端笔记详情 | `renderNote` |
| 6 | 文章详情 | `renderPost`、`buildToc`、`updateTocActive`、`applyReading` |
| 7 | 标签 / 归档 / 关于 | `renderTags`、`renderTagView`、`renderArchive`、`renderAbout` |
| 8.5 | 书架（IndexedDB） | `openBookDB`、`importBooks`、`splitChapters`、`decodeText`、`renderShelf` |
| 8.6 | 阅读器 | `renderReader`、`layoutPages`、`flipPage`、`bindPageDrag`、`loadChapter` |
| 8.65 | 听歌 | `renderMusic`、`loadSource`、`renderBiliList`、`playStream`、`bindSeek`、`bindPlayerDrag`、`queueList`、`advance`、`addLocalTracks`、`cloudUploadTracks`、`fileHash`、`bindDropZone` |
| 8.7 | 写作台 | `renderWrite`、`wpSave`、`wpLoadList`、`wpSyncCurrent` |
| 9 | 路由 | `route()` |
| 10 | 阅读进度 | `updateProgress` |
| 11 | 搜索 | `bindSearch`、`doSearch` |
| 12 | 初始化 | `init()` |

### 架构约定（改代码前请先看）

1. **渲染函数互不调用。** 页面切换只走 `route()`；需要联动时用聚合函数（如 `refreshMusicLists()`）统一调度，
   禁止 `renderA()` 里调 `renderB()` 而 `renderB()` 又调回 `renderA()` —— 会栈溢出。
2. **分层：数据层 → 计算层 → 渲染层。** 渲染函数只读最新数据、只改 DOM，不改全局状态。
3. **所有用户文本先 `escapeHtml()` 再进 DOM。** Markdown 渲染只输出白名单标签，不存在原始 HTML 注入路径。
4. **渲染模板拼接后必须接 `;`。** 曾出现 `'...' +` 后面直接跟函数调用，导致函数在 `innerHTML` 赋值前执行、
   事件全部绑定失败的坑。
5. **单文件零依赖是硬约定。** 加图表用内联 SVG，加图标用内联 `<svg path>`，不要引入任何库。
6. **播放器、提示条是全局节点。** 它们挂在 `<body>` 上，不随页面重渲染销毁。

---

## 5. 数据存在哪

| 数据 | 位置 | 换设备 |
| --- | --- | --- |
| 内置文章 | `blog.html` 的 `POSTS` | 随代码 |
| 写作台笔记/文章 | 数据表（无 SDK 时 localStorage） | 有后端则同步 |
| 上传的小说 | IndexedDB `banyue_books` / `books` + `texts` | 否，可传云端书库 |
| 本地音乐 | IndexedDB `banyue_books` / `tracks` | 否，可传云端音乐 |
| 收藏 | localStorage `wb_halfpage_favs` | 否 |
| 阅读位置、播放器位置、字号、主题 | localStorage `wb_halfpage_*` | 否 |

清浏览器数据 = 本地内容清空，页面没有自动备份。重要内容建议传云端。

### 数据表（原托管环境）

| 表 | ID | 字段 |
| --- | --- | --- |
| 半页 · 笔记与文章 | `PKaqN27AzwPuZQuCf7sXBE` | 标题 text / 内容 text / 类型 select / 标签 text / 更新时间 date / 创建时间 date |
| 半页 · 云端书库 | `IIFXDsvodFAbgS2APYyWP9` | 书名 text / 作者 text / 文件 attachment / 字数 number / 章节数 number / 更新时间 date |
| 半页 · 云端音乐 | `fBXQYzusWcHdMK5PwybdgA` | 歌名 text / 文件 attachment / 大小 number / 上传时间 date / 指纹 text |

三个 ID 硬编码在 `blog.html` 顶部（`WRITE_DB_ID` / `CLOUD_BOOK_DB` / `CLOUD_MUSIC_DB`），
换后端改这三个常量即可。完整定义见 `docs/schema.json`。

---

## 6. 后端接口

页面只依赖一个对象：

```js
window.__SMART_PAGE__.database
```

用到的 6 个方法：`query` / `addRecord` / `updateRecord` / `deleteRecord` / `uploadFile` / `getDownloadUrl`。
参数与返回结构见 **`docs/sdk-contract.md`**，里面有最小实现示例。

关键约定：

- 记录是**扁平对象**，主键 `_id`（也兼容 `record_id`）
- `query` 必须支持分页（`pageSize` 上限 200，`startCursor` 游标）
- 未登录时写操作返回 **401**，页面会把提示改成「需要登录」，不会一直转圈
- `getDownloadUrl` 返回的地址要能被浏览器 `fetch`（带 CORS），页面会把音频转成 blob 再播

没有这个对象时，页面自动降级，不影响博客、书架、本地音乐。

---

## 7. 第三方数据源

| 来源 | 用途 | 说明 |
| --- | --- | --- |
| `itunes.apple.com/search` | 搜索歌曲 | 公开接口，带 CORS，含 30 秒试听 |
| `itunes.apple.com/{hk,us,jp}/rss/topsongs/limit=10/json` | 三个地区的实时热门 | 公开 RSS，带 CORS |
| Apple 试听音频 | 播放 | 先 `fetch` 成 blob 再播（发布环境 CSP 只允许 `blob:`） |
| B站音乐区排行 | 「B站」标签 | **快照**，见下 |

**B站为什么是快照**：`api.bilibili.com` 带 `Origin` 直接 403，音乐区排行还需要 `buvid` cookie，
浏览器端拿不到。当前数据写在 `BILI_HOT` 数组里（10 条），日期在 `BILI_SNAP`。
要做成实时的，只能加一个转发服务（服务端抓取 + 加 CORS 头），页面 `renderBiliList()` 改成 fetch 它。

**抖音为什么没有数据**：没有可跨域读取的音乐榜接口；能读到的热搜话题与听歌无关。所以只做说明页 + 直达按钮。

---

## 8. 已知限制

- Apple 试听只有 **30 秒**，这是公开接口的上限。完整播放只能靠用户自己的文件。
- 阅读器只支持 **TXT / Markdown**，不支持 EPUB / PDF / MOBI。
- B站榜是快照，不是实时。
- 音乐指纹优先用 `crypto.subtle`（SHA-256 前 16 位）；非安全上下文会退化成「文件名 + 大小」的弱指纹。
- 发布页 iframe 有 CSP：不能加载外站图片/字体/脚本；外部音频必须先转 blob；外部视频不能内嵌。
- 手机上的「复制链接」浮动按钮是发布平台外层页面加的，`blog.html` 里删不掉。
- 云端文件的读写需要登录态；匿名访问时上传/下载会失败（页面会提示）。

---

## 9. 继续开发

按投入产出排的建议：

1. **接自己的后端**：实现 `docs/sdk-contract.md` 的 6 个方法，云端三块功能立刻复用；本地功能一行不用改。
2. **拆文件**：按第 4 节的分区拆成 ES modules，用 Vite 开发，构建时用 `vite-plugin-singlefile` 内联回单文件。
3. **B站榜实时化**：几十行的转发服务（抓 B站 + 加 `Access-Control-Allow-Origin`），失败回落快照。
4. **EPUB 支持**：需要解压 + 解析 OPF，建议单独引 `jszip`，注意包体积。
5. **评论/统计**：没做。个人站做评论的维护成本高于收益，统计也容易变成刷数据。

改动后：

```bash
./tools/check.sh     # 语法 + 零外链
```

再按原来的方式发布（导入页面 → 发布成公开链接）。
