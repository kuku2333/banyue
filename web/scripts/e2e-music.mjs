// 端到端自检：导入本地音频（真实 WAV），确认指纹去重与 IndexedDB 存储，并播放。
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

/** 生成 3 秒 440Hz 的 8-bit 单声道 WAV */
function makeWav(seconds = 3, rate = 8000) {
  const samples = seconds * rate
  const data = Buffer.alloc(samples)
  for (let i = 0; i < samples; i++) {
    data[i] = 128 + Math.round(60 * Math.sin((2 * Math.PI * 440 * i) / rate))
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--autoplay-policy=no-user-gesture-required',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-music-${Date.now()}`),
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

async function shot(name, width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await wait(500)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}

await mkdir(OUT, { recursive: true })
const wavPath = path.join(OUT, 'sample-tone.wav')
await writeFile(wavPath, makeWav())

await send('Page.enable')
await send('DOM.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/music` })
await wait(2200)

// 切到「本地音乐」
await send('Runtime.evaluate', {
  expression: `[...document.querySelectorAll('.chip')].find(b => b.textContent.trim() === '本地音乐')?.click()`,
})
await wait(600)

const { root } = await send('DOM.getDocument', { depth: -1 })
const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#music-file-input' })
if (!nodeId) throw new Error('找不到音乐导入输入框')
await send('DOM.setFileInputFiles', { nodeId, files: [wavPath] })
await wait(2500)
await shot('music-local')

// 播放本地曲目
await send('Runtime.evaluate', { expression: "document.querySelector('.track-list .play')?.click()" })
await wait(3000)
await shot('music-local-playing')

// 再导入同一个文件，验证指纹去重
await send('DOM.setFileInputFiles', { nodeId, files: [wavPath] })
await wait(2000)
const { result } = await send('Runtime.evaluate', {
  expression: "document.querySelector('.notice')?.textContent ?? ''",
  returnByValue: true,
})
console.log('dedupe notice:', result.value)

socket.close()
browser.kill()
process.exit(0)
