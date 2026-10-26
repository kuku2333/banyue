import MarkdownIt from 'markdown-it'
import { displayLang, highlight } from '@/lib/highlight'

export interface Heading {
  level: number
  text: string
  id: string
}

const md = new MarkdownIt({
  html: false, // 不允许原始 HTML，只有白名单标签能进 DOM
  linkify: true,
  breaks: false,
  typographer: false,
})

/** 把标题文本压成一个可读、可复用的锚点 id */
export function headingId(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[`*_~[\]()]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'section'
  const seen = used.get(base) ?? 0
  used.set(base, seen + 1)
  return seen === 0 ? base : `${base}-${seen + 1}`
}

md.core.ruler.push('collect_headings', (state) => {
  const used = new Map<string, number>()
  const headings: Heading[] = []
  const tokens = state.tokens
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (!token || token.type !== 'heading_open') continue
    const inline = tokens[i + 1]
    const level = Number(token.tag.slice(1))
    const text = (inline?.content ?? '').trim()
    const id = headingId(text, used)
    token.attrSet('id', id)
    if (level === 2 || level === 3) headings.push({ level, text, id })
  }
  ;(state.env as { headings?: Heading[] }).headings = headings
})

md.renderer.rules.link_open = (tokens, idx, options, _env, self) => {
  const href = tokens[idx]?.attrGet('href') ?? ''
  if (/^https?:\/\//i.test(href)) {
    tokens[idx]?.attrSet('target', '_blank')
    tokens[idx]?.attrSet('rel', 'noopener noreferrer')
  }
  return self.renderToken(tokens, idx, options)
}

/**
 * 代码块：加语法高亮和右上角的语言标签。
 * markdown-it 默认输出 <pre><code class="language-xxx">，这里整个接管。
 */
md.renderer.rules.fence = (tokens, idx) => {
  const token = tokens[idx]
  if (!token) return ''
  const info = (token.info ?? '').trim()
  const lang = info.split(/\s+/)[0] ?? ''
  const code = token.content.replace(/\n$/, '')
  const body = highlight(code, lang)
  return (
    `<pre class="code-block" data-lang="${escapeAttr(normalizeLangSafe(lang))}">` +
    `<span class="code-lang">${escapeAttr(displayLang(lang))}</span>` +
    `<code>${body}</code>` +
    `</pre>`
  )
}

function normalizeLangSafe(lang: string): string {
  return lang.trim().toLowerCase() || 'text'
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 渲染一篇文章：返回 HTML 与目录（h2/h3） */
export function renderMarkdown(body: string): { html: string; headings: Heading[] } {
  const env: { headings?: Heading[] } = {}
  const html = md.render(body, env)
  return { html, headings: env.headings ?? [] }
}

/** 正文有效字数：去掉空白后的字符数 */
export function countChars(body: string): number {
  return body.replace(/\s+/g, '').length
}

/** 阅读时长（分钟），按中文 400 字/分钟估算 */
export function estimateReadMinutes(chars: number): number {
  return Math.max(1, Math.round(chars / 400))
}
