// 端到端自检：播放器律动、拖拽、滚轮音量、收起展开。
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = path.resolve(process.argv[3] ?? '../.shots')

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-player-${Date.now()}`),
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

const endpoint = await new Promise((resolve, reject) => {
  let buffer = ''
  const timer = setTimeout(() => reject(new Error('等待 DevTools 端点超时')), 15000)
  browser.stderr.on('data', (chunk) => {
    buffer += String(chunk)
    const match = /DevTools listening on (ws:\/\/\S+)/.exec(buffer)
    if (match) {
      clearTimeout(timer)
      resolve(new URL(match[1]))
    }
  })
  browser.on('exit', (code) => reject(new Error(`浏览器提前退出 (${code})`)))
})

const targets = await (await fetch(`http://127.0.0.1:${endpoint.port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page')
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

let nextId = 0
const pending = new Map()
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data))
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message)
    pending.delete(message.id)
  }
})

function send(method, params = {}) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    pending.set(id, (message) => (message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result)))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function evaluate(expression) {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result.value
}
async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}
async function mouse(type, x, y) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
  })
}

await mkdir(OUT, { recursive: true })
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/music` })
await wait(2500)

// 播放榜单第一首
await evaluate("document.querySelector('.track-list .play')?.click()")
await wait(3500)
await shot('player-playing')

// 滚轮调音量
const before = await evaluate("document.querySelector('.p-vol input')?.value")
await send('Input.dispatchMouseEvent', {
  type: 'mouseWheel',
  x: 1250,
  y: 900,
  deltaX: 0,
  deltaY: -120,
})
await wait(400)
const after = await evaluate("document.querySelector('.p-vol input')?.value")
console.log('volume before/after wheel:', before, '→', after)

// 拖拽播放器
const box = await evaluate("(() => { const r = document.querySelector('.player').getBoundingClientRect(); return { x: r.x + 40, y: r.y + 30, left: r.left }; })()")
await mouse('mousePressed', box.x, box.y)
await mouse('mouseMoved', box.x - 220, box.y - 120)
await wait(120)
await mouse('mouseReleased', box.x - 220, box.y - 120)
await wait(400)
const afterDrag = await evaluate("(() => { const r = document.querySelector('.player').getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; })()")
console.log('player box before x/y:', Math.round(box.left), '| after drag left/top:', afterDrag.left, afterDrag.top)
await shot('player-dragged')

// 收起 / 展开
await evaluate("document.querySelector('.p-head [aria-label=\"收起播放器\"]')?.click()")
await wait(500)
await shot('player-capsule')
await evaluate("document.querySelector('.capsule')?.click()")
await wait(500)

console.log('done')
socket.close()
browser.kill()
process.exit(0)
