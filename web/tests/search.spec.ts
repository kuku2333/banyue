import { describe, expect, it } from 'vitest'
import { runSearch, staticEntries, type SearchEntry } from '@/lib/search'
import { posts } from '@/lib/content'

function entry(partial: Partial<SearchEntry> & { key: string; title: string }): SearchEntry {
  return {
    kind: 'post',
    subtitle: '',
    body: '',
    ...partial,
  }
}

describe('runSearch 打分', () => {
  const list: SearchEntry[] = [
    entry({ key: '1', title: '小王子', body: '一个关于玫瑰与狐狸的故事' }),
    entry({ key: '2', title: '读书笔记', body: '今天读了小王子，很有感触' }),
    entry({ key: '3', title: '雨天的咖啡馆', subtitle: '小王子 作者', body: '' }),
    entry({ key: '4', title: '无关文章', body: '完全无关' }),
  ]

  it('标题完全匹配排最前', () => {
    const out = runSearch('小王子', list)
    expect(out[0]?.title).toBe('小王子')
  })

  it('标题命中排在正文命中之前', () => {
    const out = runSearch('小王子', list)
    const titles = out.map((x) => x.title)
    expect(titles.indexOf('小王子')).toBeLessThan(titles.indexOf('读书笔记'))
  })

  it('副标题命中也能搜到', () => {
    const out = runSearch('作者', list)
    expect(out.some((x) => x.title === '雨天的咖啡馆')).toBe(true)
  })

  it('无关内容不出现在结果里', () => {
    const out = runSearch('小王子', list)
    expect(out.some((x) => x.title === '无关文章')).toBe(false)
  })

  it('空关键词返回空数组', () => {
    expect(runSearch('', list)).toEqual([])
    expect(runSearch('   ', list)).toEqual([])
  })

  it('大小写不敏感', () => {
    const withEnglish = [entry({ key: 'e', title: 'DeepSeek Harness 笔记', body: '' })]
    expect(runSearch('deepseek', withEnglish)).toHaveLength(1)
    expect(runSearch('DEEPSEEK', withEnglish)).toHaveLength(1)
  })

  it('限制返回条数', () => {
    const many = Array.from({ length: 30 }, (_, i) => entry({ key: String(i), title: `测试文章 ${i}` }))
    expect(runSearch('测试', many, 5)).toHaveLength(5)
  })

  it('同分时文章优先于标签', () => {
    const mixed: SearchEntry[] = [
      entry({ key: 't', kind: 'tag', title: '#读书' }),
      entry({ key: 'p', kind: 'post', title: '读书' }),
    ]
    const out = runSearch('读书', mixed)
    expect(out[0]?.kind).toBe('post')
  })
})

describe('staticEntries', () => {
  it('包含全部文章和标签', () => {
    const entries = staticEntries(posts)
    const postKeys = entries.filter((e) => e.kind === 'post')
    expect(postKeys).toHaveLength(posts.length)
    expect(entries.some((e) => e.kind === 'tag')).toBe(true)
  })

  it('文章条目带可跳转路由', () => {
    const entries = staticEntries(posts)
    const first = entries.find((e) => e.kind === 'post')
    expect(first?.route).toMatch(/^\/post\//)
  })

  it('能按文章标题搜到', () => {
    const entries = staticEntries(posts)
    const sample = posts[0]!
    const out = runSearch(sample.title, entries)
    expect(out.some((x) => x.route === `/post/${sample.slug}`)).toBe(true)
  })
})
