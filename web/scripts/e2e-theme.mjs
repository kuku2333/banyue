// 验证主题切换：暗 / 亮 / 跟随系统，变量生效、持久化、无闪烁
import { spawn } from 'node:child_process'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]
if (!EDGE) throw new Error('找不到 Edge')

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-theme-${Date.now()}`),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('等待 DevTools 端点超时')), 15000)
  browser.stderr.on('data', (chunk) => {
    buffer += String(chunk)
    const m = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (m) { clearTimeout(timer); resolve(new URL(m[1])) }
  })
  browser.on('exit', (c) => reject(new Error(`浏览器提前退出 (${c})`)))
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const msg = JSON.parse(String(event.data))
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
})
function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    socket.send(JSON.stringify({ id, method, params }))
  })
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (exceptionDetails) throw new Error(exceptionDetails.text)
  return result.value
}

let pass = 0, fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/` })
await wait(2500)

// 初始应为暗色
const initial = await evaluate(`document.documentElement.dataset.theme`)
check('默认是暗色', initial === 'dark', `得到 ${initial}`)

const darkBg = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)
check('暗色 --bg 正确', darkBg === '#0a0e13', darkBg)

// 找主题按钮
const hasBtn = await evaluate(`
  !!document.querySelector('.theme-btn')
`)
check('主题按钮存在', hasBtn)
if (!hasBtn) { browser.kill(); process.exit(1) }

// 点一次 → 亮色
await evaluate(`document.querySelector('.theme-btn').click()`)
await wait(400)
const afterOne = await evaluate(`document.documentElement.dataset.theme`)
check('点一次变亮色', afterOne === 'light', `得到 ${afterOne}`)

const lightBg = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`)
check('亮色 --bg 已切换', lightBg === '#f6f8fb', lightBg)

const lightText = await evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--text').trim()`)
check('亮色文字变深', lightText === '#16202b', lightText)

// 正文对比度：亮色下正文颜色不该还是白色
const bodyColor = await evaluate(`getComputedStyle(document.body).color`)
check('正文颜色跟随主题', bodyColor !== 'rgb(233, 239, 246)', bodyColor)

const READ_MODE = `(() => {
  const v = localStorage.getItem('banyue:theme')
  if (v === null) return null
  try { return JSON.parse(v) } catch { return v }
})()`

// 点第二次 → 跟随系统
await evaluate(`document.querySelector('.theme-btn').click()`)
await wait(400)
const storedMode = await evaluate(READ_MODE)
check('第二次进入跟随系统', storedMode === 'auto', `得到 ${storedMode}`)

// 点第三次 → 回到暗色
await evaluate(`document.querySelector('.theme-btn').click()`)
await wait(400)
const afterThree = await evaluate(READ_MODE)
check('第三次回到暗色', afterThree === 'dark', `得到 ${afterThree}`)

// 持久化：设为亮色后刷新应保持
await evaluate(`localStorage.setItem('banyue:theme', 'light')`)
await send('Page.navigate', { url: `${BASE}/` })
await wait(2000)
const afterReload = await evaluate(`document.documentElement.dataset.theme`)
check('刷新后保持亮色', afterReload === 'light', `得到 ${afterReload}`)

// 首屏无闪烁：检查内联脚本确实在 head 里设了 data-theme
const inlineSet = await evaluate(`
  (() => {
    const html = document.documentElement.outerHTML;
    const idx = html.indexOf("banyue:theme");
    return idx > -1 && idx < html.indexOf("<body");
  })()
`)
check('主题脚本在 body 之前执行', inlineSet)

// 跟随系统：模拟系统亮色
await evaluate(`localStorage.setItem('banyue:theme', 'auto')`)
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] })
await send('Page.navigate', { url: `${BASE}/` })
await wait(2000)
const autoLight = await evaluate(`document.documentElement.dataset.theme`)
check('跟随系统：系统亮色时页面亮色', autoLight === 'light', `得到 ${autoLight}`)

await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
await send('Page.navigate', { url: `${BASE}/` })
await wait(2000)
const autoDark = await evaluate(`document.documentElement.dataset.theme`)
check('跟随系统：系统暗色时页面暗色', autoDark === 'dark', `得到 ${autoDark}`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
