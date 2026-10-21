// 端到端自检：3D 翻书。导入一本长章节的书，截取点击翻页与拖拽翻页的过程。
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

const SENTENCES = [
  '雨从傍晚开始下，一直没停。我把窗关小了一半，让风进来一条缝。',
  '桌上的书翻到第三十七页，已经停了很久。不是读不下去，是这一页写得太准。',
  '巷子里的灯亮起来的时候，电线上的水珠一颗一颗往下掉，像是有人在天上数数。',
  '我想起很多年前的一个同样的下午，那时候还没有这间屋子，也没有这张桌子。',
  '南方的春天来得早，二月底就有蚊子。车站外面的榕树掉了一地果子，被踩得发黑。',
  '有些话当时没说，后来也就没有必要说了。它们像水汽一样，慢慢散在空气里。',
]

function makeBook() {
  const chapters = []
  for (let c = 1; c <= 4; c++) {
    const paragraphs = []
    for (let p = 0; p < 30; p++) {
      paragraphs.push(SENTENCES[(c + p) % SENTENCES.length] + SENTENCES[(c + p + 3) % SENTENCES.length])
    }
    chapters.push(`第${c}章 第${c}个下午\n\n${paragraphs.join('\n\n')}`)
  }
  return chapters.join('\n\n') + '\n'
}

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-flip-${Date.now()}`),
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

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}

async function mouse(type, x, y, extra = {}) {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button: 'left',
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
    ...extra,
  })
}

await mkdir(OUT, { recursive: true })
const bookPath = path.join(OUT, 'sample-flip-book.txt')
await writeFile(bookPath, makeBook(), 'utf8')

await send('Page.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(2200)

const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#shelf-file-input' })
await send('DOM.setFileInputFiles', { nodeId, files: [bookPath] })
await wait(2200)

await send('Runtime.evaluate', { expression: "document.querySelector('.book-main')?.click()" })
await wait(2200)
await shot('flip-1-page')

// 点击右侧翻页（动画在 headless 截图里不易定格，只验证结果）
await mouse('mousePressed', 1200, 500)
await mouse('mouseReleased', 1200, 500)
await wait(900)
await shot('flip-2-after-click')

const state = await send('Runtime.evaluate', {
  expression: "document.querySelector('.r-pages')?.textContent?.trim() ?? 'no-pages'",
  returnByValue: true,
})
console.log('page indicator after click:', state.result.value)

// 拖拽翻页：分三个角度定格，展示 3D 翻书过程
await mouse('mousePressed', 1150, 500)
await mouse('mouseMoved', 950, 500)
await wait(120)
await shot('flip-3-drag-30deg')

await mouse('mouseMoved', 750, 500)
await wait(120)
await shot('flip-4-drag-55deg')

await mouse('mouseMoved', 480, 500)
await wait(120)
await shot('flip-5-drag-90deg')

await mouse('mouseReleased', 480, 500)
await wait(900)
await shot('flip-6-after-drag')

const after = await send('Runtime.evaluate', {
  expression: "document.querySelector('.r-pages')?.textContent?.trim() ?? 'no-pages'",
  returnByValue: true,
})
console.log('page indicator after drag:', after.result.value)

socket.close()
browser.kill()
process.exit(0)
