// 端到端自检：写作台。新建草稿 → 输入 → 自动保存 → 刷新验证 → 导出 .md。
import { spawn } from 'node:child_process'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = path.resolve(process.argv[3] ?? '../.shots')
const DOWNLOADS = path.join(OUT, 'downloads')

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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-write-${Date.now()}`),
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

async function shot(name, width = 1440, height = 960) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await wait(400)
  const { data } = await send('Page.captureScreenshot', { format: 'png' })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}

await mkdir(DOWNLOADS, { recursive: true })
await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false })
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS }).catch(() => {})
await send('Page.navigate', { url: `${BASE}/write` })
await wait(2200)

await evaluate("document.querySelector('.write-empty button')?.click() ?? null")
await wait(900)

await evaluate("document.querySelector('.title-input')?.focus()")
await send('Input.insertText', { text: '在雨天写一篇稿子' })
await wait(200)

await evaluate("document.querySelector('.editor-area')?.focus()")
await send('Input.insertText', {
  text: '雨下了一整天，我没有出门。\n\n## 一、窗外的声音\n\n水滴打在空调外机上，像有人在敲一段没写完的谱子。\n\n> 安静不是没有声音，是声音不再需要你回应。\n\n- 读完半本书\n- 写了两百字\n\n**到这里就好。**\n',
})
await wait(1600)
await shot('write-editor')

const saved = await evaluate("document.querySelector('.save-state')?.textContent ?? ''")
console.log('save state:', saved)

const titleValue = await evaluate("document.querySelector('.title-input')?.value ?? ''")
console.log('title before reload:', titleValue)

// 刷新后仍然存在（IndexedDB 持久化 + 自动保存）
await send('Page.reload')
await wait(2400)
const afterReload = await evaluate("document.querySelector('.title-input')?.value ?? ''")
const draftCount = await evaluate("document.querySelectorAll('.draft-item').length")
console.log('title after reload:', afterReload, '| drafts:', draftCount)

// 导出 .md
await evaluate("[...document.querySelectorAll('.btn.tiny')].find(b => b.textContent.includes('导出'))?.click()")
await wait(1800)
const files = (await readdir(DOWNLOADS)).filter((name) => name.endsWith('.md'))
console.log('downloaded:', files.join(', ') || '(none)')
if (files.length) {
  const content = await readFile(path.join(DOWNLOADS, files[0]), 'utf8')
  console.log('export head:', JSON.stringify(content.split('\n').slice(0, 6)))
  console.log('has body:', content.includes('窗外的声音'))
}

socket.close()
browser.kill()
process.exit(0)
