import { describe, expect, it } from 'vitest'
import { autoExcerpt, draftTags, newDraft, slugify, toPostMarkdown } from '@/lib/drafts'
import { parseFrontmatter } from '@/lib/content'

const draft = {
  ...newDraft(),
  title: '雨天的书店',
  content: '## 一\n\n周六下午三点，我从地铁站出来，沿着一条种满梧桐的路往北走。\n\n第二段。',
  tags: '城市漫游, 生活观察',
  excerpt: '',
  createdAt: Date.parse('2026-10-21T10:00:00Z'),
}

describe('slugify', () => {
  it('英文标题转 kebab-case', () => {
    expect(slugify('My First Post')).toBe('my-first-post')
  })

  it('中文标题退化成日期 + 短哈希', () => {
    const slug = slugify('雨天的书店', Date.parse('2026-10-21T10:00:00Z'))
    expect(slug).toMatch(/^post-2026-10-21-[a-z0-9]{1,4}$/)
  })

  it('同一标题稳定', () => {
    expect(slugify('a b', 1)).toBe(slugify('a b', 1))
  })
})

describe('autoExcerpt', () => {
  it('跳过标题取第一段', () => {
    expect(autoExcerpt(draft.content)).toContain('周六下午三点')
  })

  it('超长截断', () => {
    expect(autoExcerpt('字'.repeat(200), 20)).toHaveLength(21)
  })

  it('空内容返回空串', () => {
    expect(autoExcerpt('   \n\n')).toBe('')
  })
})

describe('draftTags', () => {
  it('支持中英文逗号与空格', () => {
    expect(draftTags('城市 漫游，随笔,测试')).toEqual(['城市', '漫游', '随笔', '测试'])
  })
})

describe('toPostMarkdown', () => {
  const markdown = toPostMarkdown(draft)

  it('生成能被打开的 frontmatter', () => {
    const { data, body } = parseFrontmatter(markdown)
    expect(data.title).toBe('雨天的书店')
    expect(data.date).toBe('2026-10-21')
    expect(data.tags).toEqual(['城市漫游', '生活观察'])
    expect(data.featured).toBe(false)
    expect(typeof data.read).toBe('number')
    expect(body.trimStart().startsWith('## 一')).toBe(true)
  })

  it('没有手写摘要时自动补上', () => {
    const { data } = parseFrontmatter(markdown)
    expect(String(data.excerpt)).toContain('周六下午三点')
  })

  it('手写摘要优先', () => {
    const { data } = parseFrontmatter(toPostMarkdown({ ...draft, excerpt: '自己写的摘要' }))
    expect(data.excerpt).toBe('自己写的摘要')
  })
})
