// 端到端自检：书签（云端公开）+ 歌曲评论（云端公开）。
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

const SAMPLE = `第一章 雨夜

雨从傍晚开始下，一直没停。我把窗关小了一半，让风进来一条缝。

桌上的书翻到第三十七页，已经停了很久。不是读不下去，是这一页写得太准。

第二章 旧信

信是七年前寄出的，邮戳模糊，收件人写错了两个字。

我把它摊平，台灯下面，纸的纤维一根根立着。

第三章 南方

南方的春天来得早，二月底就有蚊子。车站外面的榕树掉了一地果子。
`

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-notes-${Date.now()}`),
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
const socket = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl)
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
    pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
async function evaluate(expression) {
  const { result } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return result.value
}
async function shot(name, width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await wait(400)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}
async function fill(selector, value) {
  return evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`)
}

await mkdir(OUT, { recursive: true })
await send('Page.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })

// 1) 用接口注册并登录（同源，cookie 直接生效）
const username = `note${Date.now().toString(36).slice(-6)}`
await send('Page.navigate', { url: `${BASE}/collections` })
await wait(1800)
const status = await evaluate(`fetch('/api/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: '${username}', password: 'secret123', displayName: '书签用户' })
}).then(r => r.status)`)
console.log('register status:', status)

// 2) 导入一本书并打开阅读器
const bookPath = path.join(OUT, 'sample-bookmarks.txt')
await writeFile(bookPath, SAMPLE, 'utf8')
await send('Page.navigate', { url: `${BASE}/shelf` })
await wait(1800)
const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#shelf-file-input' })
await send('DOM.setFileInputFiles', { nodeId, files: [bookPath] })
await wait(2200)
await evaluate("document.querySelector('.book-main')?.click()")
await wait(2200)

// 3) 加一个公开书签
await evaluate("[...document.querySelectorAll('.r-actions .r-btn')].find(b => b.textContent.trim() === '书签')?.click()")
await wait(700)
await fill('.bookmark-drawer .add input', '这段写得真好，记一下。')
await evaluate("document.querySelector('.bookmark-drawer .add .primary')?.click()")
await wait(1500)
console.log('bookmarks:', await evaluate("document.querySelectorAll('.bookmark-drawer .marks li').length"))
console.log('bookmark owner:', await evaluate("document.querySelector('.bookmark-drawer .marks .who')?.textContent?.trim() ?? 'none'"))
await shot('reader-bookmark')

// 4) 给正在播放的歌写评论
await send('Page.navigate', { url: `${BASE}/music` })
await wait(2400)
await evaluate("document.querySelector('.track-list .play')?.click()")
await wait(2600)
await evaluate("[...document.querySelectorAll('.p-extra .p-mode')].find(b => b.textContent.trim() === '评论')?.click()")
await wait(900)
await fill('.layer .write input', '这段贝斯太好听了。')
await evaluate("document.querySelector('.layer .write .primary')?.click()")
await wait(1500)
console.log('comments:', await evaluate("document.querySelectorAll('.layer .comment').length"))
console.log('comment owner:', await evaluate("document.querySelector('.layer .comment .who b')?.textContent?.trim() ?? 'none'"))
await shot('music-comments')

socket.close()
browser.kill()
process.exit(0)
