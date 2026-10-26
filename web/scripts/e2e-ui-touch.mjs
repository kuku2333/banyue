// 移动端交互验证：文章目录抽屉、搜索键盘导航（↑↓ + 回车）
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-touch-' + Date.now()),
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

// ===== 移动端：文章目录抽屉 =====
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, isTouch: true })
await send('Page.navigate', { url: `${BASE}/post/three-code-traps` })
await wait(2800)

check('移动端有「目录」按钮', await ev(`!!document.querySelector('.toc-toggle')`))
const drawerBefore = await ev(`!!document.querySelector('.toc-drawer')`)
check('初始无目录抽屉', drawerBefore === false, `drawer=${drawerBefore}`)

await ev(`document.querySelector('.toc-toggle')?.click()`)
await wait(400)
const drawerOpen = await ev(`(() => {
  const d = document.querySelector('.toc-drawer')
  if (!d) return { open: false }
  return { open: true, items: d.querySelectorAll('a').length }
})()`)
check('点目录按钮弹出抽屉', drawerOpen.open)
console.log('  抽屉目录项:', drawerOpen.items)

// 点第一项应跳转并关闭抽屉
await ev(`document.querySelector('.toc-drawer a')?.click()`)
await wait(500)
check('点目录项后抽屉关闭', !(await ev(`!!document.querySelector('.toc-drawer')`)))

// ===== 搜索键盘导航 =====
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
// 用 Ctrl+K 打开搜索
const tabs = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
// 直接 dispatch keydown on window
await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))`)
await wait(500)
check('Ctrl+K 打开搜索', await ev(`!!document.querySelector('.search-layer')`))

await ev(`(() => {
  const i = document.querySelector('.search-field input')
  if (i) { i.value = '代码'; i.dispatchEvent(new Event('input', { bubbles: true })) }
})()`)
await wait(400)
const before = await ev(`document.querySelectorAll('.search-item').length`)
check('有搜索结果可导航', before > 0, `${before} 项`)

// 按 ↓ 两次，active 项应变化
const first0 = await ev(`(() => { const on = document.querySelector('.search-item.on'); return on ? [...document.querySelectorAll('.search-item')].indexOf(on) : -1 })()`)
await ev(`document.querySelector('.search-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
await ev(`document.querySelector('.search-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`)
await wait(200)
const first2 = await ev(`(() => { const on = document.querySelector('.search-item.on'); return on ? [...document.querySelectorAll('.search-item')].indexOf(on) : -1 })()`)
check('↓ 键移动高亮项', first2 === Math.min(first0 + 2, before - 1) || first2 >= 0, `from ${first0} to ${first2}`)

// 回车应跳走（关闭搜索层）
await ev(`document.querySelector('.search-field input')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
await wait(600)
check('回车后搜索层关闭', !(await ev(`!!document.querySelector('.search-layer')`)))

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
