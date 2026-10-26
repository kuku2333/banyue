import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const postsDir = path.join(root, 'src', 'content', 'posts')

/** 与 scripts/postbuild.mjs 同一套解析规则，确保 SEO 字段来源可靠 */
function parseFrontmatter(raw: string): { data: Record<string, unknown> } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!match) return { data: {} }
  const data: Record<string, unknown> = {}
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    const key = line.slice(0, at).trim()
    let value: unknown = line.slice(at + 1).trim()
    if (/^["'].*["']$/.test(String(value))) value = String(value).slice(1, -1)
    if (String(value).startsWith('[') && String(value).endsWith(']')) {
      value = String(value)
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
    }
    data[key] = value
  }
  return { data }
}

describe('文章 frontmatter（SEO 依赖）', () => {
  it('每篇文章都有 title / date / excerpt', async () => {
    const files = (await readdir(postsDir)).filter((name) => name.endsWith('.md'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const raw = await readFile(path.join(postsDir, file), 'utf8')
      const { data } = parseFrontmatter(raw)
      expect(data.title, `${file} 缺 title`).toBeTruthy()
      expect(data.date, `${file} 缺 date`).toBeTruthy()
      expect(data.excerpt, `${file} 缺 excerpt`).toBeTruthy()
    }
  })

  it('date 是合法的 YYYY-MM-DD', async () => {
    const files = (await readdir(postsDir)).filter((name) => name.endsWith('.md'))
    for (const file of files) {
      const raw = await readFile(path.join(postsDir, file), 'utf8')
      const { data } = parseFrontmatter(raw)
      expect(String(data.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('tags 解析成字符串数组', async () => {
    const files = (await readdir(postsDir)).filter((name) => name.endsWith('.md'))
    for (const file of files) {
      const raw = await readFile(path.join(postsDir, file), 'utf8')
      const { data } = parseFrontmatter(raw)
      expect(Array.isArray(data.tags), `${file} 的 tags 不是数组`).toBe(true)
    }
  })

  it('slug 由文件名决定且唯一', async () => {
    const files = (await readdir(postsDir)).filter((name) => name.endsWith('.md'))
    const slugs = files.map((name) => name.replace(/\.md$/, ''))
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/)
  })
})
