// 本地视觉自检：用系统里的 Edge（Chromium）无头模式截图，支持手机尺寸模拟。
// 用法：node scripts/shot.mjs <url> <out.png> [width] [height] [mobile]
import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

const EDGE_CANDIDATES = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean)

const [url, out, widthArg, heightArg, mobileArg] = process.argv.slice(2)
if (!url || !out) {
  console.error('用法: node scripts/shot.mjs <url> <out.png> [width=1440] [height=1000] [mobile=0]')
  process.exit(1)
}

const width = Number(widthArg ?? 1440)
const height = Number(heightArg ?? 1000)
const mobile = mobileArg === '1'

const browser = spawn(EDGE_CANDIDATES.find(Boolean), [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-shot-${Date.now()}`),
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

const port = endpoint.port
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((target) => target.type === 'page')
if (!page) throw new Error('没有找到可用的页面 target')

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
    pending.set(id, (message) => (message.error ? reject(new Error(message.error.message)) : resolve(message.result)))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: mobile ? 2 : 1,
  mobile,
})
await send('Page.navigate', { url })
await new Promise((resolve) => setTimeout(resolve, 2500))

const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
await writeFile(out, Buffer.from(data, 'base64'))
console.log(`saved ${out} (${width}x${height}${mobile ? ' mobile' : ''})`)

socket.close()
browser.kill()
process.exit(0)
