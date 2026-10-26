// 验证文章页：代码高亮、语言标签、复制按钮、图片点击放大
import { spawn } from 'node:child_process'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-post-' + Date.now()),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((res, rej) => {
  let b = ''
  const t = setTimeout(() => rej(new Error('timeout')), 15000)
  browser.stderr.on('data', (c) => {
    b += String(c)
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(b)
    if (m) { clearTimeout(t); res(new URL(m[1])) }
  })
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const pg = targets.find((t) => t.type === 'page')
const ws = new WebSocket(pg.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))

let id = 0
const pend = new Map()
ws.addEventListener('message', (e) => {
  const m = JSON.parse(String(e.data))
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) }
})
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id
    pend.set(i, (x) => (x.error ? rej(new Error(x.error.message)) : res(x.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const ev = async (expr) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: true,
  })
  if (exceptionDetails) return 'ERR:' + exceptionDetails.text
  return result.value
}

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

const SLUG = 'three-code-traps'
await send('Page.navigate', { url: `${BASE}/post/${SLUG}` })
await wait(2800)

/* ---------------- 代码高亮 ---------------- */
const codeInfo = await ev(`
(() => {
  const pres = [...document.querySelectorAll('.prose pre')];
  if (!pres.length) return { error: 'no-pre' };
  const first = pres[0];
  const lang = first.querySelector('.code-lang')?.textContent?.trim() ?? '';
  const tokens = ['tok-key','tok-str','tok-num','tok-com','tok-fn'].map(c => ({
    cls: c, count: first.querySelectorAll('.' + c).length
  }));
  // 文本内容是否完整（不丢字）
  const codeText = first.querySelector('code')?.textContent ?? '';
  const copyBtn = !!first.querySelector('.copy-btn');
  // 代码块底色是否跟随主题变量
  const bg = getComputedStyle(first).backgroundColor;
  return {
    count: pres.length,
    lang,
    tokens: tokens.filter(t => t.count > 0).map(t => t.cls),
    textLen: codeText.length,
    hasConst: codeText.includes('const'),
    hasAwait: codeText.includes('await'),
    copyBtn,
    bg
  };
})()
`)
if (codeInfo.error) {
  check('文章页有代码块', false, codeInfo.error)
} else {
  console.log('  代码块数量:', codeInfo.count, '语言标签:', codeInfo.lang)
  check('代码块有语言标签', codeInfo.lang.length > 0, `"${codeInfo.lang}"`)
  check('代码块有语法高亮', codeInfo.tokens.length >= 2, `命中 ${codeInfo.tokens.join(',')}`)
  check('代码文本完整', codeInfo.hasConst && codeInfo.hasAwait, `长度 ${codeInfo.textLen}`)
  check('有复制按钮', codeInfo.copyBtn)
}

/* 代码块底色必须跟随主题：切换亮色后应当变浅 */
const darkBg = await ev(`getComputedStyle(document.querySelector('.prose pre')).backgroundColor`)
await ev(`document.querySelector('.theme-panel') || document.querySelector('.theme-btn').click()`)
await wait(300)
await ev(`[...document.querySelectorAll('.mode-btn')].find(b => b.textContent.includes('亮色'))?.click()`)
await wait(500)
const lightBg = await ev(`getComputedStyle(document.querySelector('.prose pre')).backgroundColor`)
function brightness(value) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value ?? '')
  return m ? (Number(m[1]) + Number(m[2]) + Number(m[3])) / 3 : 0
}
console.log('  暗色代码底:', darkBg, '| 亮色代码底:', lightBg)
check('代码块底色跟随主题', brightness(lightBg) > 180 && brightness(darkBg) < 80, `暗${Math.round(brightness(darkBg))} 亮${Math.round(brightness(lightBg))}`)
// 切回暗色，后面图片测试保持原状
await ev(`document.querySelector('.theme-panel') || document.querySelector('.theme-btn').click()`)
await wait(250)
await ev(`[...document.querySelectorAll('.mode-btn')].find(b => b.textContent.includes('暗色'))?.click()`)
await wait(350)

// 检查所有代码块都有语言标签
const allLang = await ev(`
  [...document.querySelectorAll('.prose pre')].map(p => p.querySelector('.code-lang')?.textContent?.trim() ?? '')
`)
console.log('  全部语言标签:', JSON.stringify(allLang))
check('每个代码块都有标签', allLang.every((l) => l && l.length > 0), JSON.stringify(allLang))

/* ---------------- 图片放大 ---------------- */
const imgInfo = await ev(`
(() => {
  const img = document.querySelector('.prose img');
  if (!img) return { error: 'no-img' };
  return {
    src: img.getAttribute('src'),
    cursor: getComputedStyle(img).cursor,
    lazy: img.loading,
    role: img.getAttribute('role'),
    tabIndex: img.tabIndex,
    labelled: !!img.getAttribute('aria-label')
  };
})()
`)
if (imgInfo.error) {
  check('文章页有图片', false, imgInfo.error)
} else {
  console.log('  图片:', imgInfo.src)
  check('图片可点（cursor: zoom-in）', imgInfo.cursor === 'zoom-in', imgInfo.cursor)
  check('图片懒加载', imgInfo.lazy === 'lazy', String(imgInfo.lazy))
  check('图片键盘可达', imgInfo.tabIndex >= 0, `tabIndex=${imgInfo.tabIndex}`)
  check('图片有 aria-label', imgInfo.labelled)

  // 点开
  await ev(`document.querySelector('.prose img').click()`)
  await wait(700)
  const lb = await ev(`
  (() => {
    const box = document.querySelector('.lightbox');
    if (!box) return { open: false };
    return {
      open: true,
      hasImg: !!box.querySelector('img'),
      modal: box.getAttribute('aria-modal'),
      hint: box.querySelector('.lb-hint')?.textContent?.trim() ?? '',
      bodyOverflow: document.body.style.overflow
    };
  })()
`)
  check('点击后灯箱打开', lb.open)
  check('灯箱里有大图', lb.hasImg)
  check('灯箱是模态对话框', lb.modal === 'true', String(lb.modal))
  check('打开时锁定页面滚动', lb.bodyOverflow === 'hidden', String(lb.bodyOverflow))
  check('有操作提示', (lb.hint ?? '').includes('Esc'), `"${lb.hint}"`)

  // Esc 关闭
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await wait(600)
  const closed = await ev(`!document.querySelector('.lightbox')`)
  check('Esc 能关闭灯箱', closed)
  const restored = await ev(`document.body.style.overflow`)
  check('关闭后恢复页面滚动', restored === '', `"${restored}"`)
}

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
