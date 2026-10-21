export interface Chapter {
  title: string
  content: string
}

export interface BookMeta {
  title: string
  author: string
}

const CHAPTER_PATTERN =
  /^[\s　]*(第[零〇一二三四五六七八九十百千万两\d]{1,8}[章节回卷集部篇]|序章|楔子|引子|前言|后记|尾声|番外[零〇一二三四五六七八九十\d]{0,3})(?:[\s　:：、.．·\-—][^\n]{0,30})?[\s　]*$/

/** 解码上传的文本：优先 UTF-8，失败回落 GB18030（覆盖 GBK/GB2312），并去掉 BOM */
export function decodeText(buffer: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buffer)
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  const hasReplacement = /\uFFFD/.test(utf8)
  if (!hasReplacement) {
    return { text: stripBom(utf8), encoding: 'utf-8' }
  }
  try {
    const gb = new TextDecoder('gb18030', { fatal: false }).decode(bytes)
    return { text: stripBom(gb), encoding: 'gb18030' }
  } catch {
    return { text: stripBom(utf8), encoding: 'utf-8' }
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

/** 从文件名或正文头部提取书名与作者 */
export function parseBookMeta(fileName: string, text: string): BookMeta {
  const head = text.slice(0, 400)
  const titleMatch = /^\s*(?:书名|标题)\s*[：:]\s*(.+)$/m.exec(head)
  const authorMatch = /^\s*(?:作者|作\s*者)\s*[：:]\s*(.+)$/m.exec(head)
  const fallback = fileName.replace(/\.[^.]+$/, '').replace(/[《》\s]+/g, ' ').trim()
  return {
    title: (titleMatch?.[1] ?? fallback).trim().slice(0, 80) || '未命名',
    author: (authorMatch?.[1] ?? '').trim().slice(0, 40),
  }
}

/** 去掉正文开头的「书名：/作者：」行与末尾的重复章节标题 */
export function cleanBookText(text: string): string {
  return text
    .replace(/^\s*(?:书名|标题)\s*[：:].*\r?\n?/i, '')
    .replace(/^\s*(?:作者|作\s*者)\s*[：:].*\r?\n?/i, '')
    .replace(/^\s*\r?\n/, '')
    .trim()
}

/**
 * 按「第 X 章 / 卷 / 回 / 序章 / 楔子 / 番外」切分章节；
 * 识别不到（少于 2 个标题）时按 fallbackSize 字在段落边界切节。
 */
export function splitChapters(text: string, fallbackSize = 3000): Chapter[] {
  const lines = text.split(/\r?\n/)
  const marks: { index: number; title: string }[] = []

  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.length > 48) return
    if (/[。！？；]/.test(trimmed)) return
    if (CHAPTER_PATTERN.test(trimmed)) marks.push({ index, title: trimmed })
  })

  const usable = marks.length >= 2 ? marks : []
  if (!usable.length) return chunkByLength(text, fallbackSize)

  const chapters: Chapter[] = []
  const preface = lines.slice(0, usable[0]!.index).join('\n').trim()
  if (preface.length > 200) chapters.push({ title: '开篇', content: preface })

  usable.forEach((mark, i) => {
    const end = usable[i + 1]?.index ?? lines.length
    const content = lines
      .slice(mark.index + 1, end)
      .join('\n')
      .trim()
    chapters.push({ title: mark.title, content })
  })

  return chapters.filter((chapter) => chapter.content.length > 0)
}

function chunkByLength(text: string, size: number): Chapter[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim())
  const chapters: Chapter[] = []
  let buffer: string[] = []
  let length = 0

  const flush = () => {
    if (!buffer.length) return
    chapters.push({ title: `第 ${chapters.length + 1} 节`, content: buffer.join('\n\n') })
    buffer = []
    length = 0
  }

  for (const paragraph of paragraphs) {
    buffer.push(paragraph)
    length += paragraph.length
    if (length >= size) flush()
  }
  flush()
  return chapters
}

/** 中文字数：去掉空白后的字符数 */
export function countWords(text: string): number {
  return text.replace(/\s+/g, '').length
}

/** 段落切分：给渲染层用，保留空行结构 */
export function toParagraphs(content: string): string[] {
  return content
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
}
