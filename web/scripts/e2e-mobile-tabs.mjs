// 移动端底栏：窄屏不挤压、亮色不变黑、当前项有指示
import { spawn } from 'node:child_process'
import path from 'node:path'

const BASE = 'http://localhost:5173'
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
].filter(Boolean)[0]

const browser = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=0',
  '--no-first-run',
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-tabs-' + Date.now()),
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

let pass = 0
let fail = 0
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${detail}`) }
}

await send('Page.enable')
await send('Runtime.enable')

const widths = [
  [375, 'iPhone SE'],
  [360, '小屏安卓'],
  [320, '最窄常见'],
  [414, 'iPhone Plus'],
]

for (const [width, label] of widths) {
  await send('Emulation.setDeviceMetricsOverride', {
    width, height: 780, deviceScaleFactor: 2, mobile: true,
  })
  await send('Page.navigate', { url: `${BASE}/` })
  await wait(2000)

  const info = await ev(`
  (() => {
    const nav = document.querySelector('.tabs');
    if (!nav) return { error: 'no-nav' };
    const links = [...nav.querySelectorAll('a')];
    const boxes = links.map(a => {
      const r = a.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: a.textContent.trim() };
    });
    // 文字是否被压成竖排（高度远大于宽度）
    const vertical = boxes.filter(b => b.h > b.w * 1.2);
    // 是否有横向溢出
    const navRect = nav.getBoundingClientRect();
    const overflow = links.some(a => {
      const r = a.getBoundingClientRect();
      return r.right > navRect.right + 0.5 || r.left < navRect.left - 0.5;
    });
    const activeEl = nav.querySelector('a.on');
    const activeStyle = activeEl ? getComputedStyle(activeEl) : null;
    return {
      count: links.length,
      minWidth: Math.min(...boxes.map(b => b.w)),
      minHeight: Math.min(...boxes.map(b => b.h)),
      vertical: vertical.length,
      overflow,
      hasActive: !!activeEl,
      activeColor: activeStyle ? activeStyle.color : '',
      activeShadow: activeStyle ? activeStyle.boxShadow : '',
      navBg: getComputedStyle(nav).backgroundColor,
      labels: boxes.map(b => b.text)
    };
  })()
`)
  if (info.error) {
    check(`${width}px ${label}`, false, info.error)
    continue
  }
  console.log(`\n[${width}px ${label}] 每个 tab 宽 ${info.minWidth}px，高 ${info.minHeight}px`)
  check('五个 tab 都在', info.count === 5, `${info.count} 个`)
  check('文字未竖排', info.vertical === 0, `${info.vertical} 个竖排`)
  check('无横向溢出', !info.overflow)
  check('点击区高度 ≥44px', info.minHeight >= 44, `${info.minHeight}px`)
  check('当前项有高亮', info.hasActive)
}

// 亮色主题下底栏不能是黑条
console.log('\n[亮色主题]')
await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 780, deviceScaleFactor: 2, mobile: true })
await send('Page.navigate', { url: `${BASE}/` })
await wait(1800)
await ev(`document.querySelector('.theme-panel') || document.querySelector('.theme-btn').click()`)
await wait(300)
await ev(`[...document.querySelectorAll('.mode-btn')].find(b => b.textContent.includes('亮色'))?.click()`)
await wait(400)
const lightBg = await ev(`getComputedStyle(document.querySelector('.tabs')).backgroundColor`)
console.log('  底栏背景:', lightBg)
// 兼容两种格式：rgb(247, 249, 252) 和 color(srgb 0.968 0.976 0.988 / 0.92)
function averageBrightness(value) {
  if (!value) return 0
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value)
  if (rgb) return (Number(rgb[1]) + Number(rgb[2]) + Number(rgb[3])) / 3
  const srgb = /color\(\s*srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value)
  if (srgb) {
    return ((Number(srgb[1]) + Number(srgb[2]) + Number(srgb[3])) / 3) * 255
  }
  return 0
}
const bright = averageBrightness(lightBg)
check('亮色下底栏是浅色', bright > 180, `平均亮度 ${Math.round(bright)}`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
browser.kill()
process.exit(fail ? 1 : 0)
