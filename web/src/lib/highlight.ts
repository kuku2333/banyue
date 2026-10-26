// 轻量语法高亮：不引第三方库（shiki 光 wasm 就几 MB），用正则切词实现常见语言。
// 目标是「读起来有区分度」，不追求 100% 正确的词法分析。
//
// 输出 HTML 字符串，所有文本都先转义，插入的只有本模块生成的 <span class>。

/** 支持的语言别名，统一到内部 id */
const ALIASES: Record<string, string> = {
  js: 'js',
  javascript: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
  ts: 'ts',
  typescript: 'ts',
  tsx: 'ts',
  py: 'py',
  python: 'py',
  sh: 'sh',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  json: 'json',
  html: 'html',
  xml: 'html',
  vue: 'html',
  css: 'css',
  scss: 'css',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  go: 'go',
  rs: 'rust',
  rust: 'rust',
  java: 'java',
}

export function normalizeLang(raw: string | undefined): string {
  const key = (raw ?? '').trim().toLowerCase()
  return ALIASES[key] ?? (key === '' ? 'text' : key)
}

/** 各语言的关键字表 */
const KEYWORDS: Record<string, string[]> = {
  js: 'const let var function return if else for while do break continue class extends new this super import from export default async await try catch finally throw typeof instanceof in of delete void yield switch case null undefined true false'.split(' '),
  ts: 'const let var function return if else for while do break continue class extends implements interface type enum namespace new this super import from export default async await try catch finally throw typeof instanceof keyof as in of delete void yield switch case null undefined true false public private protected readonly static abstract declare'.split(' '),
  py: 'def class return if elif else for while break continue import from as pass raise try except finally with lambda yield global nonlocal assert del in is not and or None True False async await'.split(' '),
  sh: 'if then else elif fi for while do done case esac function return local export source alias unset echo cd ls cp mv rm mkdir rmdir touch cat grep sed awk find chmod chown sudo curl wget git npm pnpm node python pip docker'.split(' '),
  go: 'func package import return if else for range switch case default type struct interface map chan go defer select break continue var const nil true false'.split(' '),
  rust: 'fn let mut const static struct enum impl trait pub use mod crate self super return if else match for while loop break continue where as dyn ref move async await unsafe true false Some None Ok Err'.split(' '),
  java: 'public private protected class interface extends implements static final void int long double float boolean char String new return if else for while do switch case default break continue try catch finally throw throws import package this super null true false abstract synchronized'.split(' '),
  sql: 'select from where insert into values update set delete create table drop alter add index join left right inner outer on group by order having limit offset as and or not null distinct count sum avg min max'.split(' '),
  css: [],
  html: [],
  json: 'true false null'.split(' '),
  yaml: 'true false null'.split(' '),
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 通用的分词高亮：按「字符串 → 注释 → 数字 → 关键字 → 函数名」顺序切，
 * 已被前面规则吃掉的部分用占位符保护，避免二次匹配。
 */
function highlightGeneric(code: string, lang: string): string {
  const keywords = new Set(KEYWORDS[lang] ?? [])
  const parts: string[] = []
  let rest = code

  // 用占位符保护已处理片段。
  // 关键：占位符不能含数字/字母/下划线——否则后续的「数字」「关键字」正则
  // 会把占位符本身也匹配走，造成嵌套覆盖、内容丢失。
  // 这里用 Unicode 私用区的单字符（\uE000 起），既无词边界也不会被任何正则命中。
  const stash: string[] = []
  const hold = (html: string): string => {
    stash.push(html)
    return String.fromCharCode(0xe000 + stash.length - 1)
  }

  // 1. 字符串（含模板串、单双引号，允许转义）
  rest = rest.replace(/(["'`])(?:\\.|(?!\1)[\s\S])*?\1/g, (match) => hold(`<span class="tok-str">${escapeHtml(match)}</span>`))

  // 2. 注释（// 与 /* */）
  rest = rest.replace(/\/\/[^\n]*/g, (match) => hold(`<span class="tok-com">${escapeHtml(match)}</span>`))
  rest = rest.replace(/\/\*[\s\S]*?\*\//g, (match) => hold(`<span class="tok-com">${escapeHtml(match)}</span>`))
  // Python / Bash 的 # 注释
  if (lang === 'py' || lang === 'sh' || lang === 'yaml') {
    rest = rest.replace(/(^|\s)#[^\n]*/g, (match, lead: string) =>
      lead + hold(`<span class="tok-com">${escapeHtml(match.slice(lead.length))}</span>`),
    )
  }

  // 3. 数字
  rest = rest.replace(/\b(0x[\da-fA-F]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)\b/g, (match) =>
    hold(`<span class="tok-num">${escapeHtml(match)}</span>`),
  )

  // 4. 关键字（按词边界）
  if (keywords.size) {
    const pattern = new RegExp(`\\b(${[...keywords].join('|')})\\b`, 'g')
    rest = rest.replace(pattern, (match) => hold(`<span class="tok-key">${escapeHtml(match)}</span>`))
  }

  // 5. 函数调用：标识符紧跟左括号
  rest = rest.replace(/\b([A-Za-z_$][\w$]*)(?=\s*\()/g, (match) =>
    hold(`<span class="tok-fn">${escapeHtml(match)}</span>`),
  )

  parts.push(rest)

  // 还原占位符（私用区字符 → 对应的高亮 HTML）
  let html = parts.join('')
  html = html.replace(/[\uE000-\uF8FF]/g, (ch) => stash[ch.charCodeAt(0) - 0xe000] ?? '')
  return html
}

/** JSON：只区分键、字符串、数字、布尔 */
function highlightJson(code: string): string {
  const escaped = escapeHtml(code)
  return escaped
    .replace(/(&quot;(?:\\.|[^&])*?&quot;)(\s*:)/g, '<span class="tok-key">$1</span>$2')
    .replace(/:\s*(&quot;(?:\\.|[^&])*?&quot;)/g, ': <span class="tok-str">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="tok-key">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>')
}

/** HTML/XML：标签名、属性名、属性值 */
function highlightHtml(code: string): string {
  const escaped = escapeHtml(code)
  return escaped
    .replace(/(&lt;\/?)([\w:-]+)/g, '$1<span class="tok-key">$2</span>')
    .replace(/([\w:-]+)=(&quot;.*?&quot;)/g, '<span class="tok-fn">$1</span>=<span class="tok-str">$2</span>')
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-com">$1</span>')
}

/** CSS：选择器、属性、值、注释 */
function highlightCss(code: string): string {
  const escaped = escapeHtml(code)
  return escaped
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-com">$1</span>')
    .replace(/([.#]?[\w-]+)(?=\s*\{)/g, '<span class="tok-fn">$1</span>')
    .replace(/([\w-]+)(\s*:)/g, '<span class="tok-key">$1</span>$2')
    .replace(/(#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw|s|ms)?\b)/g, '<span class="tok-num">$1</span>')
}

/** 对一段代码做高亮，返回 HTML（已转义，可安全 v-html） */
export function highlight(code: string, lang: string | undefined): string {
  const id = normalizeLang(lang)
  switch (id) {
    case 'json':
      return highlightJson(code)
    case 'html':
      return highlightHtml(code)
    case 'css':
      return highlightCss(code)
    case 'text':
      return escapeHtml(code)
    default:
      return highlightGeneric(code, id)
  }
}

/** 语言在界面上的显示名 */
const DISPLAY: Record<string, string> = {
  js: 'JavaScript',
  ts: 'TypeScript',
  py: 'Python',
  sh: 'Shell',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  yaml: 'YAML',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  text: '代码',
}

export function displayLang(lang: string | undefined): string {
  const id = normalizeLang(lang)
  return DISPLAY[id] ?? id.toUpperCase()
}
