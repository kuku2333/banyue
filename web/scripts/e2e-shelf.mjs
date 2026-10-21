// 端到端自检：在真实浏览器里导入一本书，打开阅读器并截图。
// 用法：node scripts/e2e-shelf.mjs [baseUrl] [outDir]
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

const SAMPLE = `书名：测试之书
作者：某甲

第一章 雨夜

雨从傍晚开始下，一直没停。我把窗关小了一半，让风进来一条缝。

桌上的书翻到第三十七页，已经停了很久。不是读不下去，是这一页写得太准，像有人隔着纸在说我。

第二章 旧信

信是七年前寄出的，邮戳模糊，收件人写错了两个字。

我把它摊平，台灯下面，纸的纤维一根根立着，像某种被时间定住的呼吸。

第三章 南方

南方的春天来得早，二月底就有蚊子。

车站外面的榕树掉了一地果子，被踩得发黑。我拖着箱子站在出口，等了二十分钟，没有人来接我。
`

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-e2e-${Date.now()}`),
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

async function shot(name, width = 1440, height = 1400, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: mobile ? 2 : 1,
    mobile,
  })
  await wait(600)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}

await mkdir(OUT, { recursive: true })
const samplePath = path.join(OUT, 'sample-book.txt')
await writeFile(samplePath, SAMPLE, 'utf8')

await send('Page.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1400, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(2500)

const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#shelf-file-input' })
if (!nodeId) throw new Error('找不到导入输入框')

await send('DOM.setFileInputFiles', { nodeId, files: [samplePath] })
await wait(2500)
await shot('shelf')

// 打开第一本书
await send('Runtime.evaluate', { expression: "document.querySelector('.book-main')?.click()" })
await wait(2500)
await shot('reader-paged')

// 翻一页，确认分页有效
await send('Runtime.evaluate', {
  expression: 'document.querySelectorAll(".reader-foot .r-btn")[1]?.click()',
})
await wait(900)
await shot('reader-page-2')

// 打开目录
await send('Runtime.evaluate', {
  expression: '[...document.querySelectorAll(".r-actions .r-btn")].find(b=>b.textContent.includes("目录"))?.click()',
})
await wait(700)
await shot('reader-toc')

// 手机尺寸
await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(1800)
await shot('shelf-mobile', 390, 844, true)

// 阅读设置与滚动模式
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false })
await send('Runtime.evaluate', { expression: "document.querySelector('.book-main')?.click()" })
await wait(2000)
await send('Runtime.evaluate', {
  expression: '[...document.querySelectorAll(".r-actions .r-btn")].find(b=>b.textContent.includes("设置"))?.click()',
})
await wait(700)
await shot('reader-settings')
await send('Runtime.evaluate', {
  expression: '[...document.querySelectorAll(".seg button")].find(b=>b.textContent.trim()==="滚动")?.click()',
})
await wait(900)
await shot('reader-scroll')

console.log('ok')
socket.close()
browser.kill()
process.exit(0)
