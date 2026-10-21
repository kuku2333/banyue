import { describe, expect, it } from 'vitest'
import {
  cleanBookText,
  countWords,
  decodeText,
  parseBookMeta,
  splitChapters,
  toParagraphs,
} from '@/lib/books'

const SAMPLE = `书名：测试之书
作者：某甲

序章 开端

这是序章的内容，讲一个开始。

第一章 相遇

第一章正文第一段。

第一章正文第二段。

第二章 别离

第二章正文。
`

describe('decodeText', () => {
  it('解码 UTF-8', () => {
    const buffer = new TextEncoder().encode('中文内容').buffer
    const { text, encoding } = decodeText(buffer)
    expect(text).toBe('中文内容')
    expect(encoding).toBe('utf-8')
  })

  it('UTF-8 乱码时回落 GB18030', () => {
    // 「中文」的 GBK 编码
    const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]).buffer
    const { text, encoding } = decodeText(gbk)
    expect(encoding).toBe('gb18030')
    expect(text).toBe('中文')
  })
})

describe('parseBookMeta', () => {
  it('优先读正文头部的书名与作者', () => {
    expect(parseBookMeta('无名.txt', SAMPLE)).toEqual({ title: '测试之书', author: '某甲' })
  })

  it('没有头部信息时用文件名', () => {
    expect(parseBookMeta('《山河故人》.txt', '正文')).toEqual({ title: '山河故人', author: '' })
  })
})

describe('cleanBookText', () => {
  it('去掉开头的书名与作者行', () => {
    const cleaned = cleanBookText(SAMPLE)
    expect(cleaned.startsWith('序章 开端')).toBe(true)
  })
})

describe('splitChapters', () => {
  it('按「第 X 章 / 序章」切分', () => {
    const chapters = splitChapters(cleanBookText(SAMPLE))
    expect(chapters.map((c) => c.title)).toEqual(['序章 开端', '第一章 相遇', '第二章 别离'])
    expect(chapters[1]!.content).toContain('第一章正文第二段')
  })

  it('识别不到标题时按长度切节', () => {
    const long = Array.from({ length: 40 }, (_, i) => `第 ${i} 段，`.repeat(40)).join('\n\n')
    const chapters = splitChapters(long, 800)
    expect(chapters.length).toBeGreaterThan(1)
    expect(chapters[0]!.title).toBe('第 1 节')
  })

  it('忽略正文里像标题的长句', () => {
    const text = '第一章 开始\n\n' + '这是一段很长的正文，'.repeat(20) + '\n\n第二章 继续\n\n正文'
    const chapters = splitChapters(text)
    expect(chapters).toHaveLength(2)
  })
})

describe('工具函数', () => {
  it('统计字数忽略空白', () => {
    expect(countWords('一二 三\n四')).toBe(4)
  })

  it('段落切分去掉空行', () => {
    expect(toParagraphs('第一段\n\n\n第二段\n')).toEqual(['第一段', '第二段'])
  })
})
