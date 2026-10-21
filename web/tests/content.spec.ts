import { describe, expect, it } from 'vitest'
import {
  archiveGroups,
  blogStats,
  neighbours,
  parseFrontmatter,
  parsePost,
  posts,
  relatedPosts,
  tagStats,
} from '@/lib/content'
import { countChars, estimateReadMinutes, renderMarkdown } from '@/lib/markdown'

const sample = `---
title: "测试文章"
excerpt: '简介'
date: 2026-01-02
read: 3
tags: ["甲", "乙"]
featured: true
---

## 第一节

正文 **加粗** 与 \`code\`。

### 小节

> 引用
`

describe('frontmatter', () => {
  it('解析引号、数字、布尔与行内数组', () => {
    const { data, body } = parseFrontmatter(sample)
    expect(data.title).toBe('测试文章')
    expect(data.excerpt).toBe('简介')
    expect(data.date).toBe('2026-01-02')
    expect(data.read).toBe(3)
    expect(data.featured).toBe(true)
    expect(data.tags).toEqual(['甲', '乙'])
    expect(body.trimStart().startsWith('## 第一节')).toBe(true)
  })

  it('没有 frontmatter 时原文返回', () => {
    const { data, body } = parseFrontmatter('纯文本')
    expect(data).toEqual({})
    expect(body).toBe('纯文本')
  })
})

describe('markdown', () => {
  it('只把 h2/h3 收进目录，并生成稳定锚点', () => {
    const { html, headings } = renderMarkdown('## 第一节\n\n### 小节 A\n\n#### 不进目录')
    expect(headings.map((h) => h.text)).toEqual(['第一节', '小节 A'])
    expect(html).toContain('id="第一节"')
    expect(html).toContain('id="小节-a"')
  })

  it('原始 HTML 被转义', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('外链加 noreferrer', () => {
    const { html } = renderMarkdown('[外链](https://example.com)')
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('字数与阅读时长', () => {
    expect(countChars('一 二\n三')).toBe(3)
    expect(estimateReadMinutes(800)).toBe(2)
    expect(estimateReadMinutes(10)).toBe(1)
  })
})

describe('内容聚合', () => {
  const post = parsePost('/x/sample.md', sample)

  it('parsePost 生成 slug 与统计字段', () => {
    expect(post.slug).toBe('sample')
    expect(post.title).toBe('测试文章')
    expect(post.featured).toBe(true)
    expect(post.chars).toBeGreaterThan(0)
  })

  it('标签统计按数量倒序', () => {
    const posts = [
      { ...post, slug: 'a', tags: ['甲'] },
      { ...post, slug: 'b', tags: ['甲', '乙'] },
    ]
    expect(tagStats(posts)).toEqual([
      { name: '甲', count: 2 },
      { name: '乙', count: 1 },
    ])
  })

  it('归档按年月分组', () => {
    const posts = [
      { ...post, slug: 'a', date: '2026-03-01' },
      { ...post, slug: 'b', date: '2025-11-01' },
      { ...post, slug: 'c', date: '2026-01-01' },
    ]
    const groups = archiveGroups(posts)
    expect(groups.map((g) => g.year)).toEqual(['2026', '2025'])
    expect(groups[0]?.months.map((m) => m.month)).toEqual(['03', '01'])
  })

  it('统计总数', () => {
    const stats = blogStats([{ ...post, tags: ['甲'] }, { ...post, slug: 'b', tags: ['乙'] }])
    expect(stats.posts).toBe(2)
    expect(stats.tags).toBe(2)
  })

  it('相关阅读按标签重合度排序', () => {
    const related = relatedPosts('city-bookstore')
    expect(related.length).toBeGreaterThan(0)
    for (const item of related) {
      expect(item.tags.some((tag) => ['城市漫游', '生活观察'].includes(tag))).toBe(true)
    }
  })

  it('上下篇不会越界', () => {
    const newest = posts[0]!.slug
    const oldest = posts[posts.length - 1]!.slug
    expect(neighbours(newest).prev).toBeUndefined()
    expect(neighbours(oldest).next).toBeUndefined()
    expect(neighbours(oldest).prev).toBeDefined()
  })
})
