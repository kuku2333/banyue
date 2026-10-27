// 端到端自检：数学工具页面渲染、添加函数曲线、切换工具、分页保存。
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:5173'
const OUT = path.resolve(process.argv[3] ?? '../.shots')

const EDGE = [
  process.env.EDGE_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]

if (!EDGE) throw new Error('找不到 Edge')

const browser = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', `dsh-math-${Date.now()}`),
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

async function shot(name, width = 1440, height = 1000) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  await wait(500)
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'))
  console.log(`shot ${name}.png`)
}

await mkdir(OUT, { recursive: true })

await send('Page.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/math` })
await wait(2500)

// 1. 页面标题渲染
const heading = await evaluate(`document.querySelector('h1')?.textContent`)
console.log('页面标题:', heading)
if (!heading || !heading.includes('数学')) throw new Error('页面标题不对')

// 2. 添加函数 sin(x)
await evaluate(`
  (() => {
    const input = document.querySelector('.expr-input');
    input.value = 'sin(x)';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()
`)
await wait(300)
await evaluate(`[...document.querySelectorAll('.func-bar .btn')].find(b => b.textContent.includes('画曲线'))?.click()`)
await wait(800)

const funcChips = await evaluate(`document.querySelectorAll('.func-chip').length`)
console.log('函数数量:', funcChips)
if (funcChips < 1) throw new Error('添加函数失败')

// 3. 再添加一条 x^2
await evaluate(`
  (() => {
    const input = document.querySelector('.expr-input');
    input.value = 'x^2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()
`)
await wait(200)
await evaluate(`[...document.querySelectorAll('.func-bar .btn')].find(b => b.textContent.includes('画曲线'))?.click()`)
await wait(800)

const funcChips2 = await evaluate(`document.querySelectorAll('.func-chip').length`)
console.log('函数数量(加第二条):', funcChips2)
if (funcChips2 < 2) throw new Error('添加第二条函数失败')

// === 新增：快捷函数按钮 + 公式模板 + 代入求值 + 定积分 ===
const hasToken = await evaluate(`[...document.querySelectorAll('.token-btn')].some(b => b.textContent.trim()==='sin')`)
console.log('快捷函数按钮(sin):', hasToken)
if (!hasToken) throw new Error('缺少快捷函数按钮')

const hasTemplate = await evaluate(`[...document.querySelectorAll('.template-btn')].some(b => b.textContent.includes('二次函数'))`)
console.log('公式模板按钮:', hasTemplate)
if (!hasTemplate) throw new Error('缺少公式模板按钮')

// 点公式模板「二次函数」应把表达式填进输入框
await evaluate(`[...document.querySelectorAll('.template-btn')].find(b=>b.textContent.includes('二次函数'))?.click()`)
await wait(200)
const tplVal = await evaluate(`document.querySelector('.expr-input')?.value`)
console.log('点模板后输入框:', tplVal)
if (!tplVal || !tplVal.includes('x^2')) throw new Error('模板未填入')

// 点快捷插入「sin」应把 sin() 插入到光标处
await evaluate(`
  (() => {
    const input = document.querySelector('.expr-input');
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()
`)
await wait(100)
await evaluate(`[...document.querySelectorAll('.token-btn')].find(b => b.textContent.trim()==='sin')?.click()`)
await wait(200)
const afterInsert = await evaluate(`document.querySelector('.expr-input')?.value`)
console.log('插入 sin 后:', afterInsert)
if (!afterInsert || !afterInsert.includes('sin(')) throw new Error('快捷插入未生效')

// 代入求值：默认 x=1；已画 x^2，f≈1, f'≈2
await wait(400)
const evalOut = await evaluate(`document.querySelector('.calc-out')?.textContent ?? ''`)
console.log('代入求值区:', evalOut.replace(/\\s+/g, ' ').trim().slice(0, 60))
if (!evalOut || !evalOut.includes('x^2')) throw new Error('代入求值区未出现')

// 定积分：默认 ∫₀¹，x^2 ≈ 0.333
const integOut = await evaluate(`[...document.querySelectorAll('.calc-row')].map(r=>r.textContent).join(' | ') ?? ''`)
console.log('定积分区:', integOut.replace(/\\s+/g, ' ').trim().slice(0, 60))
if (!integOut.includes('≈')) throw new Error('定积分区未出现')

await shot('math-functions', 1440, 1000)

// 4. 切换坐标工具（切线）
await evaluate(`[...document.querySelectorAll('.tool-btn')].find(b => b.textContent.includes('切线'))?.click()`)
await wait(400)
const tangentActive = await evaluate(`[...document.querySelectorAll('.tool-btn')].find(b => b.textContent.includes('切线'))?.classList.contains('on')`)
console.log('切线工具激活:', tangentActive)
if (!tangentActive) throw new Error('切线工具未激活')

// 5. 加页
await evaluate(`[...document.querySelectorAll('.btn')].find(b => b.textContent.includes('加页'))?.click()`)
await wait(800)
const pageText = await evaluate(`document.querySelector('.page-indicator')?.textContent`)
console.log('分页:', pageText)
if (!pageText || !pageText.includes('2')) throw new Error('加页失败')

// 6. 保存
await evaluate(`[...document.querySelectorAll('.btn')].find(b => b.textContent.trim() === '保存')?.click()`)
await wait(600)

// 7. 切到草稿工具（文字）
await evaluate(`[...document.querySelectorAll('.tool-btn')].find(b => b.textContent.includes('字'))?.click()`)
await wait(300)
const textActive = await evaluate(`[...document.querySelectorAll('.tool-btn')].find(b => b.textContent.includes('字'))?.classList.contains('on')`)
console.log('文字工具激活:', textActive)

await shot('math-full', 1440, 1000)

console.log('✅ 数学工具端到端自检通过')
browser.kill()
process.exit(0)
