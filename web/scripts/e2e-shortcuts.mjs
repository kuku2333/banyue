// 快捷键帮助面板：? 键打开、Esc 关闭、页脚按钮打开、输入框聚焦时不触发
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-shortcut-' + Date.now()),
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
const press = async (key, code, extra = {}) => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: extra.vk, ...extra })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: extra.vk, ...extra })
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

// 初始没有面板
check('初始无面板', !(await ev(`!!document.querySelector('.shortcut-backdrop')`)))

// ? 打开
await press('?', 'Slash', { shiftKey: true })
await wait(500)
const opened = await ev(`
(() => {
  const box = document.querySelector('.shortcut-backdrop')
  if (!box) return { open: false }
  const keys = [...box.querySelectorAll('kbd')].map(k => k.textContent.trim())
  const groups = [...box.querySelectorAll('.shortcut-group h3')].map(h => h.textContent.trim())
  return { open: true, keys, groups, dialog: box.getAttribute('role'), modal: box.getAttribute('aria-modal') }
})()
`)
check('? 打开帮助面板', opened.open)
check('是模态对话框', opened.dialog === 'dialog' && opened.modal === 'true', `${opened.dialog}/${opened.modal}`)
console.log('  分组:', JSON.stringify(opened.groups))
check('含全局/播放器/阅读器分组', ['全局','播放器','阅读器'].every((g) => opened.groups?.includes(g)))
console.log('  快捷键键位示例:', opened.keys?.slice(0, 8).join(' '))
check('列出了 Ctrl/K 与 ?', opened.keys?.includes('K') && opened.keys?.includes('?'))

// Esc 关闭
await press('Escape', 'Escape', { vk: 27 })
await wait(400)
check('Esc 关闭面板', !(await ev(`!!document.querySelector('.shortcut-backdrop')`)))

// 页脚按钮打开
await ev(`document.querySelector('.foot-help')?.click()`)
await wait(400)
check('页脚按钮也能打开', await ev(`!!document.querySelector('.shortcut-backdrop')`))
await press('Escape', 'Escape', { vk: 27 })
await wait(300)

// 输入框聚焦时不触发 ?
await ev(`(() => { const i = document.createElement('input'); i.id='__probe'; document.body.appendChild(i); i.focus(); })()`)
await wait(200)
await press('?', 'Slash', { shiftKey: true })
await wait(300)
check('输入框聚焦时 ? 不触发', !(await ev(`!!document.querySelector('.shortcut-backdrop')`)))
await ev(`document.getElementById('__probe')?.remove()`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
