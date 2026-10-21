import type { DraftRecord } from './db'
import { countWords } from './books'
import { estimateReadMinutes } from './markdown'

/** 标题转 slug：保留字母数字，中文标题退化成日期 + 短哈希 */
export function slugify(title: string, fallbackSeed = Date.now()): string {
  const latin = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
  if (latin.length >= 2) return latin.slice(0, 60)
  const date = new Date(fallbackSeed).toISOString().slice(0, 10)
  return `post-${date}-${Math.abs(hashCode(title || String(fallbackSeed))).toString(36).slice(0, 4)}`
}

function hashCode(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return hash
}

/** 从正文第一段自动生成摘要 */
export function autoExcerpt(content: string, max = 90): string {
  const paragraph = content
    .split(/\n{2,}/)
    .filter((block) => !/^\s*#{1,6}\s/.test(block))
    .map((block) => block.replace(/^#+\s*/, '').replace(/[*_`>#-]/g, '').trim())
    .find((block) => block.length > 3)
  if (!paragraph) return ''
  return paragraph.length > max ? `${paragraph.slice(0, max)}…` : paragraph
}

export function draftTags(tags: string): string[] {
  return tags
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
}

/** 生成可以直接放进 src/content/posts/ 的 Markdown */
export function toPostMarkdown(draft: DraftRecord): string {
  const words = countWords(draft.content)
  const tags = draftTags(draft.tags)
  const excerpt = draft.excerpt.trim() || autoExcerpt(draft.content)
  const front = [
    '---',
    `title: ${JSON.stringify(draft.title.trim() || '未命名')}`,
    `excerpt: ${JSON.stringify(excerpt)}`,
    `date: ${new Date(draft.createdAt).toISOString().slice(0, 10)}`,
    `read: ${estimateReadMinutes(words)}`,
    `tags: [${tags.map((tag) => JSON.stringify(tag)).join(', ')}]`,
    'featured: false',
    '---',
    '',
  ].join('\n')
  return `${front}${draft.content.trim()}\n`
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function newDraft(): DraftRecord {
  const now = Date.now()
  return {
    id: `draft-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: '',
    content: '',
    tags: '',
    excerpt: '',
    createdAt: now,
    updatedAt: now,
  }
}
