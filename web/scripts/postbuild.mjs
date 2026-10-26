// 构建后生成 SEO 资产：rss.xml、sitemap.xml、robots.txt，
// 并为每篇文章生成带 og/JSON-LD 的静态 HTML（分享到社交平台才有一张像样的卡片）。
//
// 这些文件必须构建期产出：爬虫和订阅器不执行 JS，SPA 的运行时 meta 它们看不到。
import { readdir, readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const postsDir = path.join(root, 'src', 'content', 'posts')

/** 站点地址：CI 里用 SITE_URL 覆盖，本地默认占位 */
const SITE = (process.env.SITE_URL ?? 'https://banyue.example.com').replace(/\/$/, '')
const SITE_NAME = '半月'
const AUTHOR = '雷半斩'
const DESCRIPTION = '半月 · 雷半斩的生活随笔与读书笔记，关于城市、阅读与慢下来的日常。'

/** 极简 frontmatter 解析：只取 SEO 需要的几个字段 */
function parseFrontmatter(raw) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { data: {}, body: raw }
  const data = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    let value = line.slice(at + 1).trim()
    if (/^["'].*["']$/.test(value)) value = value.slice(1, -1)
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    } else if (/^\d+$/.test(value)) {
      value = Number(value)
    } else if (value === 'true' || value === 'false') {
      value = value === 'true'
    }
    data[key] = value
  }
  return { data, body: match[2] }
}

function escapeXml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 去掉正文里的 markdown 语法，给 description 用 */
function plainText(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const files = (await readdir(postsDir)).filter((name) => name.endsWith('.md'))
const posts = []
for (const file of files) {
  const raw = await readFile(path.join(postsDir, file), 'utf8')
  const { data, body } = parseFrontmatter(raw)
  const slug = file.replace(/\.md$/, '')
  posts.push({
    slug,
    title: String(data.title ?? slug),
    excerpt: String(data.excerpt ?? plainText(body).slice(0, 120)),
    date: String(data.date ?? ''),
    tags: Array.isArray(data.tags) ? data.tags : [],
    body: plainText(body),
  })
}
posts.sort((a, b) => (a.date < b.date ? 1 : -1))

await mkdir(dist, { recursive: true })

/* ---------------- RSS 2.0 ---------------- */
const rssItems = posts
  .map((post) => {
    const url = `${SITE}/post/${post.slug}`
    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${new Date(`${post.date}T00:00:00+08:00`).toUTCString()}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
${post.tags.map((tag) => `      <category>${escapeXml(tag)}</category>`).join('\n')}
    </item>`
  })
  .join('\n')

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_NAME)}</title>
    <link>${escapeXml(SITE)}</link>
    <description>${escapeXml(DESCRIPTION)}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(`${SITE}/rss.xml`)}" rel="self" type="application/rss+xml" />
${rssItems}
  </channel>
</rss>
`
await writeFile(path.join(dist, 'rss.xml'), rss, 'utf8')

/* ---------------- sitemap.xml ---------------- */
const staticRoutes = [
  { path: '/', priority: '1.0', changefreq: 'daily' },
  { path: '/tags', priority: '0.7', changefreq: 'weekly' },
  { path: '/archive', priority: '0.6', changefreq: 'weekly' },
  { path: '/shelf', priority: '0.6', changefreq: 'weekly' },
  { path: '/music', priority: '0.6', changefreq: 'weekly' },
  { path: '/math', priority: '0.5', changefreq: 'monthly' },
  { path: '/bili', priority: '0.4', changefreq: 'monthly' },
  { path: '/about', priority: '0.5', changefreq: 'monthly' },
]

const sitemapUrls = [
  ...staticRoutes.map(
    (route) => `  <url>
    <loc>${escapeXml(SITE + route.path)}</loc>
    <changefreq>${route.changefreq}</changefreq>
    <priority>${route.priority}</priority>
  </url>`,
  ),
  ...posts.map(
    (post) => `  <url>
    <loc>${escapeXml(`${SITE}/post/${post.slug}`)}</loc>
    <lastmod>${escapeXml(post.date)}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>`,
  ),
]

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.join('\n')}
</urlset>
`
await writeFile(path.join(dist, 'sitemap.xml'), sitemap, 'utf8')

/* ---------------- robots.txt ---------------- */
const robots = `User-agent: *
Allow: /
Disallow: /write
Disallow: /collections

Sitemap: ${SITE}/sitemap.xml
`
await writeFile(path.join(dist, 'robots.txt'), robots, 'utf8')

/* ---------------- 每篇文章的静态 HTML ---------------- */
const indexHtml = await readFile(path.join(dist, 'index.html'), 'utf8')

function buildPostHtml(post) {
  const url = `${SITE}/post/${post.slug}`
  const title = `${post.title} · ${SITE_NAME}`
  const desc = escapeHtml(post.excerpt)
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    author: { '@type': 'Person', name: AUTHOR },
    publisher: { '@type': 'Organization', name: SITE_NAME },
    mainEntityOfPage: url,
    keywords: post.tags.join(','),
  })

  const head = `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${desc}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(post.title)}" />
    <meta property="og:description" content="${desc}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
    <meta property="article:published_time" content="${escapeHtml(post.date)}" />
${post.tags.map((tag) => `    <meta property="article:tag" content="${escapeHtml(tag)}" />`).join('\n')}
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(post.title)}" />
    <meta name="twitter:description" content="${desc}" />
    <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE_NAME)}" href="${escapeHtml(`${SITE}/rss.xml`)}" />
    <script type="application/ld+json">${jsonLd}</script>`

  // 替换 index.html 里原有的 title/description，其余原样保留（保留 app 挂载点）
  return indexHtml
    .replace(/<title>[\s\S]*?<\/title>/, head.trim())
    .replace(/<meta name="description"[^>]*>/, '')
}

let written = 0
for (const post of posts) {
  const dir = path.join(dist, 'post', post.slug)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'index.html'), buildPostHtml(post), 'utf8')
  written += 1
}

/* ---------------- 首页也补上 RSS 与 canonical ---------------- */
const homeHtml = indexHtml
  .replace(
    '</head>',
    `    <link rel="canonical" href="${escapeHtml(SITE)}/" />
    <link rel="alternate" type="application/rss+xml" title="${escapeHtml(SITE_NAME)}" href="${escapeHtml(`${SITE}/rss.xml`)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(SITE_NAME)}" />
    <meta property="og:description" content="${escapeHtml(DESCRIPTION)}" />
    <meta property="og:url" content="${escapeHtml(SITE)}/" />
    <meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />
  </head>`,
  )
await writeFile(path.join(dist, 'index.html'), homeHtml, 'utf8')

// 404 用原始模板，避免带上首页 canonical
await copyFile(path.join(dist, 'index.html'), path.join(dist, '404.html'))

console.log(
  `postbuild: rss.xml / sitemap.xml / robots.txt 已生成；${written} 篇文章静态页；SPA 回退 404.html`,
)
