import { describe, expect, it } from 'vitest'
import { displayLang, highlight, normalizeLang } from '@/lib/highlight'

/** 从高亮结果里剥掉 span 标签，还原成纯文本，用于校验「内容没丢」 */
function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

describe('normalizeLang', () => {
  it('常见别名归一', () => {
    expect(normalizeLang('js')).toBe('js')
    expect(normalizeLang('javascript')).toBe('js')
    expect(normalizeLang('TS')).toBe('ts')
    expect(normalizeLang('py')).toBe('py')
    expect(normalizeLang('bash')).toBe('sh')
    expect(normalizeLang('yml')).toBe('yaml')
  })

  it('未知语言原样返回，空值归 text', () => {
    expect(normalizeLang('brainfuck')).toBe('brainfuck')
    expect(normalizeLang('')).toBe('text')
    expect(normalizeLang(undefined)).toBe('text')
  })
})

describe('displayLang', () => {
  it('给出可读名称', () => {
    expect(displayLang('js')).toBe('JavaScript')
    expect(displayLang('py')).toBe('Python')
    expect(displayLang('sh')).toBe('Shell')
    expect(displayLang(undefined)).toBe('代码')
  })
})

describe('高亮基本正确性', () => {
  it('关键字被包起来', () => {
    const out = highlight('const x = 1', 'js')
    expect(out).toContain('tok-key')
    expect(out).toContain('const')
  })

  it('字符串被包起来', () => {
    const out = highlight('const s = "hello"', 'js')
    expect(out).toContain('tok-str')
  })

  it('数字被包起来', () => {
    const out = highlight('let n = 42', 'js')
    expect(out).toContain('tok-num')
  })

  it('注释被包起来', () => {
    const out = highlight('// 这是注释\nconst a = 1', 'js')
    expect(out).toContain('tok-com')
  })

  it('函数调用被识别', () => {
    const out = highlight('console.log(1)', 'js')
    expect(out).toContain('tok-fn')
  })

  it('Python 的 # 注释', () => {
    const out = highlight('# 注释\ndef foo():', 'py')
    expect(out).toContain('tok-com')
    expect(out).toContain('tok-key')
  })

  it('JSON 的键与值区分', () => {
    const out = highlight('{"name": "半月", "count": 3}', 'json')
    expect(out).toContain('tok-key')
    expect(out).toContain('tok-str')
    expect(out).toContain('tok-num')
  })

  it('HTML 标签名高亮', () => {
    const out = highlight('<div class="a">文字</div>', 'html')
    expect(out).toContain('tok-key')
  })

  it('CSS 属性高亮', () => {
    const out = highlight('.a { color: red; }', 'css')
    expect(out).toContain('tok-key')
  })
})

describe('内容完整性', () => {
  const samples = [
    ['const a = "b" // c', 'js'],
    ['def f(x):\n    return x + 1', 'py'],
    ['echo "hi" | grep h', 'sh'],
    ['{"a": [1, 2]}', 'json'],
    ['<p>hello</p>', 'html'],
    ['.x { margin: 0 }', 'css'],
    ['SELECT * FROM t WHERE id = 1', 'sql'],
  ] as const

  it('剥掉标签后与原文一致（不丢字）', () => {
    for (const [code, lang] of samples) {
      expect(stripTags(highlight(code, lang))).toBe(code)
    }
  })

  it('纯文本模式不改变内容', () => {
    const code = 'a < b && c > d'
    expect(stripTags(highlight(code, 'text'))).toBe(code)
  })
})

describe('XSS 防护', () => {
  it('尖括号被转义，不会生成真实标签', () => {
    const out = highlight('<script>alert(1)</script>', 'text')
    expect(out).not.toContain('<script>')
    expect(out).toContain('&lt;script&gt;')
  })

  it('JS 代码里的标签也被转义', () => {
    const out = highlight('const html = "<img src=x onerror=alert(1)>"', 'js')
    expect(out).not.toContain('<img')
    expect(out).toContain('&lt;img')
  })

  it('引号被转义', () => {
    const out = highlight('const s = "a"', 'js')
    expect(out).not.toMatch(/<span class="tok-str">"a"<\/span>/)
    expect(out).toContain('&quot;')
  })

  it('HTML 语言下属性值里的脚本被转义', () => {
    const out = highlight('<a href="javascript:alert(1)">x</a>', 'html')
    // 关键是「不产生真实标签」：尖括号必须转义，且不能出现可执行的 <a href=
    expect(out).not.toContain('<a href=')
    expect(out).not.toMatch(/<a\s/)
    expect(out).toContain('&lt;')
    // 标签名被高亮包着，所以按片段断言
    expect(out).toContain('>a</span>')
    expect(stripTags(out)).toBe('<a href="javascript:alert(1)">x</a>')
  })
})
