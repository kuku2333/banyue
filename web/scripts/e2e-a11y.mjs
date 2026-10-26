// 无障碍基本检查：skip-link、lang、主内容可达、图片可聚焦
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-a11y-' + Date.now()),
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

await send('Page.navigate', { url: `${BASE}/` })
await wait(2500)

check('html 有 lang', await ev(`document.documentElement.lang === 'zh-CN'`))
check('存在 skip-link', await ev(`!!document.querySelector('.skip-link')`))
check('存在 <main id=main>', await ev(`!!document.querySelector('main#main')`))

// 第一次 Tab 应当聚焦到 skip-link（它是 DOM 第一个可聚焦元素）
const tab1 = await ev(`
(() => {
  document.activeElement?.blur?.()
  return new Promise((res) => {
    const step = () => {
      const el = document.activeElement
      if (el && el.classList?.contains('skip-link')) return res(true)
      if (!el || el === document.body) return res(false)
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }))
      // 实际上浏览器焦点移动由真实事件驱动，这里回退检测：直接判断 skip-link 存在且可聚焦
      return res(null)
    }
    step()
  })
})()
`)
// 上面的 JS Tab 模拟不可靠，改用在真实元素上调用 focus + 检查可见性
const skipVisible = await ev(`
(() => {
  const a = document.querySelector('.skip-link')
  if (!a) return false
  a.focus()
  return document.activeElement === a
})()
`)
check('skip-link 可聚焦', skipVisible)
const skipHref = await ev(`document.querySelector('.skip-link')?.getAttribute('href')`)
check('skip-link 指向 #main', skipHref === '#main', String(skipHref))

// 文章页：正文图片应有 role/tabindex/aria-label（decorateImages）
await send('Page.navigate', { url: `${BASE}/post/three-code-traps` })
await wait(2400)
const imgInfo = await ev(`
(() => {
  const img = document.querySelector('.prose img')
  if (!img) return { found: false }
  return {
    found: true,
    role: img.getAttribute('role'),
    tab: img.tabIndex,
    label: !!img.getAttribute('aria-label'),
    cursor: getComputedStyle(img).cursor
  }
})()
`)
check('正文图片存在', imgInfo.found)
if (imgInfo.found) {
  check('图片 role=button', imgInfo.role === 'button', String(imgInfo.role))
  check('图片键盘可达 tabindex>=0', imgInfo.tab >= 0, `tab=${imgInfo.tab}`)
  check('图片有 aria-label', imgInfo.label)
}

// 主题切换按钮应有 aria-label
const themeBtn = await ev(`document.querySelector('.theme-btn')?.getAttribute('aria-label') || document.querySelector('[aria-label*="主题"]')?.getAttribute('aria-label')`)
check('主题按钮有 aria-label', !!themeBtn, String(themeBtn))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
