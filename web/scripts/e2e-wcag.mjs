// 全配色 × 明暗 的对比度检查（通过真实 UI 点选，避免直接写 localStorage 的格式歧义）
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-wcag-' + Date.now()),
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

await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: `${BASE}/` })
await wait(2200)

const MEASURE = `
(function () {
  function lum(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  function parse(c) {
    var m = c.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    var parts = m[1].split(',').map(function (s) { return parseFloat(s) })
    return { rgb: parts.slice(0, 3), a: parts.length > 3 ? parts[3] : 1 }
  }
  function bgOf(el) {
    // 实心按钮的背景是用伪元素画的，backgroundColor 是透明的；
    // 这类元素直接取 --accent 当底色，否则会把深色字算在页面底色上得出错误结论。
    if (el.classList && el.classList.contains('btn--solid')) {
      var accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
      var parsed = parse(accent)
      // --accent 是 hex，parse 只认 rgb()；手工转一下
      if (!parsed && /^#[0-9a-fA-F]{6}$/.test(accent)) {
        return [
          parseInt(accent.slice(1, 3), 16),
          parseInt(accent.slice(3, 5), 16),
          parseInt(accent.slice(5, 7), 16)
        ]
      }
      if (parsed) return parsed.rgb
    }
    var n = el
    while (n && n !== document.documentElement) {
      var cs = getComputedStyle(n)
      var c = parse(cs.backgroundColor)
      if (c && c.a >= 0.95) return c.rgb
      n = n.parentElement
    }
    var root = parse(getComputedStyle(document.documentElement).backgroundColor)
    return root ? root.rgb : [255, 255, 255]
  }
  function ratio(fg, bg) {
    var l1 = lum(fg), l2 = lum(bg)
    var hi = l1 > l2 ? l1 : l2, lo = l1 > l2 ? l2 : l1
    return (hi + 0.05) / (lo + 0.05)
  }
  var list = [
    ['.site-header .nav-links a', '导航'],
    ['.brand b', '站点名'],
    ['.post-card h3', '卡片标题'],
    ['.post-card p', '卡片摘要'],
    ['.post-card .meta time', '卡片日期'],
    ['.post-card .tag', '卡片标签'],
    ['.muted', '次要文字'],
    ['.eyebrow', '眉题'],
    ['.page-head h1', '页面标题'],
    ['.site-footer', '页脚'],
    ['.btn', '主按钮']
  ]
  var worst = 99, worstLabel = ''
  var fails = []
  for (var i = 0; i < list.length; i++) {
    var sel = list[i][0], label = list[i][1]
    var el = document.querySelector(sel)
    if (!el) continue
    var cs = getComputedStyle(el)
    var fg = parse(cs.color)
    if (!fg) continue
    var bg = bgOf(el)
    var r = ratio(fg.rgb, bg)
    var need = (parseFloat(cs.fontSize) >= 18 || parseInt(cs.fontWeight, 10) >= 700) ? 3.0 : 4.5
    if (r < need) fails.push(label + ' ' + (Math.round(r * 100) / 100) + '<' + need)
    if (r < worst) { worst = r; worstLabel = label }
  }
  return { worst: Math.round(worst * 100) / 100, worstLabel: worstLabel, fails: fails }
})()
`

const palettes = [
  ['青绿', 'teal'],
  ['暖纸', 'paper'],
  ['夜空', 'night'],
  ['森绿', 'forest'],
  ['樱粉', 'sakura'],
]
const modes = [
  ['暗色', 'dark'],
  ['亮色', 'light'],
]

let pass = 0
let fail = 0

for (const [modeLabel, modeId] of modes) {
  for (const [paletteLabel, paletteId] of palettes) {
    // 打开面板 → 选明暗 → 选配色
    await ev(`document.querySelector('.theme-panel') || document.querySelector('.theme-btn').click()`)
    await wait(250)
    await ev(`[...document.querySelectorAll('.mode-btn')].find(b => b.textContent.includes('${modeLabel}'))?.click()`)
    await wait(250)
    await ev(`[...document.querySelectorAll('.palette-btn')].find(b => b.textContent.includes('${paletteLabel}'))?.click()`)
    await wait(450)

    const applied = await ev(
      `document.documentElement.dataset.theme + '/' + document.documentElement.dataset.palette`,
    )
    const data = await ev(MEASURE)
    if (typeof data === 'string') {
      console.log(`  ✗ ${modeId}/${paletteId} 脚本错误: ${data}`)
      fail += 1
      continue
    }
    const ok = data.fails.length === 0
    if (ok) pass += 1
    else fail += 1
    console.log(
      `  ${ok ? '✓' : '✗'} ${(modeId + '/' + paletteId).padEnd(13)} 应用=${applied}`.padEnd(48) +
        `最低 ${String(data.worst).padStart(5)}（${data.worstLabel}）` +
        (ok ? '' : `\n      不达标: ${data.fails.join(', ')}`),
    )
  }
}

console.log(`\n结果：${pass} 组合达标，${fail} 组合有问题`)
browser.kill()
process.exit(fail ? 1 : 0)
