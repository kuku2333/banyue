import { countChars, estimateReadMinutes, renderMarkdown, type Heading } from './markdown'

export interface Post {
  slug: string
  title: string
  excerpt: string
  date: string
  read: number
  tags: string[]
  featured: boolean
  html: string
  headings: Heading[]
  chars: number
}

export interface TagStat {
  name: string
  count: number
}

interface Frontmatter {
  [key: string]: string | number | boolean | string[]
}

/** 只支持本项目用到的 YAML 子集：字符串（可带引号）、数字、布尔、行内数组 */
export function parseFrontmatter(raw: string): { data: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw)
  if (!match) return { data: {}, body: raw }

  const data: Frontmatter = {}
  for (const line of (match[1] ?? '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue
    const sep = line.indexOf(':')
    if (sep < 0) continue
    const key = line.slice(0, sep).trim()
    const value = line.slice(sep + 1).trim()
    if (!key) continue
    data[key] = parseScalar(value)
  }
  return { data, body: raw.slice(match[0].length) }
}

function parseScalar(value: string): string | number | boolean | string[] {
  if (value.startsWith('[') && value.endsWith(']')) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => unquote(item.trim()))
      .filter((item) => item.length > 0)
  }
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value)
  return unquote(value)
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    try {
      return JSON.parse(value.startsWith("'") ? `"${value.slice(1, -1)}"` : value)
    } catch {
      return value.slice(1, -1)
    }
  }
  return value
}

const modules = import.meta.glob('../content/posts/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function parsePost(path: string, raw: string): Post {
  const { data, body } = parseFrontmatter(raw)
  const { html, headings } = renderMarkdown(body)
  const chars = countChars(body)
  const slug = path.split('/').pop()?.replace(/\.md$/, '') ?? 'untitled'
  const tags = Array.isArray(data.tags) ? data.tags : String(data.tags ?? '').split(',').filter(Boolean)
  const read = typeof data.read === 'number' ? data.read : estimateReadMinutes(chars)

  return {
    slug,
    title: String(data.title ?? slug),
    excerpt: String(data.excerpt ?? ''),
    date: String(data.date ?? '1970-01-01'),
    read,
    tags: tags.map((tag) => tag.trim()).filter(Boolean),
    featured: data.featured === true,
    html,
    headings,
    chars,
  }
}

export const posts: Post[] = Object.entries(modules)
  .map(([path, raw]) => parsePost(path, raw))
  .sort((a, b) => b.date.localeCompare(a.date))

export function findPost(slug: string): Post | undefined {
  return posts.find((post) => post.slug === slug)
}

export function tagStats(source: Post[] = posts): TagStat[] {
  const counts = new Map<string, number>()
  for (const post of source) {
    for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}

export function postsByTag(tag: string): Post[] {
  return posts.filter((post) => post.tags.includes(tag))
}

export interface Neighbours {
  prev?: Post
  next?: Post
}

/** 时间倒序列表里，prev = 更新的一篇，next = 更早的一篇 */
export function neighbours(slug: string): Neighbours {
  const index = posts.findIndex((post) => post.slug === slug)
  if (index < 0) return {}
  return { prev: posts[index - 1], next: posts[index + 1] }
}

/** 相关阅读：按标签重合度排序，重合度相同再按时间 */
export function relatedPosts(slug: string, limit = 3): Post[] {
  const current = findPost(slug)
  if (!current) return []
  return posts
    .filter((post) => post.slug !== slug)
    .map((post) => ({
      post,
      score: post.tags.filter((tag) => current.tags.includes(tag)).length,
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.post.date.localeCompare(a.post.date))
    .slice(0, limit)
    .map((entry) => entry.post)
}

export function blogStats(source: Post[] = posts) {
  const tags = tagStats(source)
  const chars = source.reduce((sum, post) => sum + post.chars, 0)
  const years = new Set(source.map((post) => post.date.slice(0, 4)))
  return { posts: source.length, tags: tags.length, chars, years: years.size }
}

export interface ArchiveGroup {
  year: string
  months: { month: string; posts: Post[] }[]
}

export function archiveGroups(source: Post[] = posts): ArchiveGroup[] {
  const years = new Map<string, Map<string, Post[]>>()
  for (const post of source) {
    const year = post.date.slice(0, 4)
    const month = post.date.slice(5, 7)
    if (!years.has(year)) years.set(year, new Map())
    const months = years.get(year)!
    if (!months.has(month)) months.set(month, [])
    months.get(month)!.push(post)
  }
  return [...years.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([year, months]) => ({
      year,
      months: [...months.entries()]
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([month, list]) => ({
          month,
          posts: list.sort((a, b) => b.date.localeCompare(a.date)),
        })),
    }))
}
