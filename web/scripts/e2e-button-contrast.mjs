// 单独校验实心按钮：渐变两端都要满足 4.5:1
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
  '--user-data-dir=' + path.join(process.env.TEMP ?? '.', 'dsh-grad-' + Date.now()),
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

const PROBE = `
(function () {
  function hex2rgb(h) {
    h = h.trim()
    var m = /^#([0-9a-fA-F]{6})$/.exec(h)
    if (!m) return null
    var v = m[1]
    return [parseInt(v.slice(0,2),16), parseInt(v.slice(2,4),16), parseInt(v.slice(4,6),16)]
  }
  function lum(rgb) {
    var c = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) })
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  function ratio(a, b) {
    var l1 = lum(a), l2 = lum(b)
    var hi = l1 > l2 ? l1 : l2, lo = l1 > l2 ? l2 : l1
    return (hi + 0.05) / (lo + 0.05)
  }
  var root = getComputedStyle(document.documentElement)
  var a1 = hex2rgb(root.getPropertyValue('--accent'))
  var a2 = hex2rgb(root.getPropertyValue('--accent-2'))
  var onRaw = root.getPropertyValue('--on-accent').trim()
  var on = hex2rgb(onRaw) || (onRaw === '#ffffff' ? [255,255,255] : null)
  if (!a1 || !a2 || !on) return { error: 'color parse failed: ' + onRaw }
  return {
    accent: Math.round(ratio(on, a1) * 100) / 100,
    accent2: Math.round(ratio(on, a2) * 100) / 100,
    onColor: onRaw
  }
})()
`

const palettes = [
  ['青绿', 'teal'], ['暖纸', 'paper'], ['夜空', 'night'], ['森绿', 'forest'], ['樱粉', 'sakura'],
]
const modes = [['暗色', 'dark'], ['亮色', 'light']]

let pass = 0
let fail = 0
for (const [modeLabel, modeId] of modes) {
  for (const [paletteLabel, paletteId] of palettes) {
    await ev(`document.querySelector('.theme-panel') || document.querySelector('.theme-btn').click()`)
    await wait(200)
    await ev(`[...document.querySelectorAll('.mode-btn')].find(b => b.textContent.includes('${modeLabel}'))?.click()`)
    await wait(200)
    await ev(`[...document.querySelectorAll('.palette-btn')].find(b => b.textContent.includes('${paletteLabel}'))?.click()`)
    await wait(350)

    const data = await ev(PROBE)
    if (data.error) {
      console.log(`  ✗ ${modeId}/${paletteId}: ${data.error}`)
      fail += 1
      continue
    }
    const min = Math.min(data.accent, data.accent2)
    const ok = min >= 4.5
    if (ok) pass += 1
    else fail += 1
    console.log(
      `  ${ok ? '✓' : '✗'} ${(modeId + '/' + paletteId).padEnd(13)} 按钮文字 ${data.onColor}  渐变左端 ${data.accent}  右端 ${data.accent2}`,
    )
  }
}

console.log(`\n实心按钮：${pass} 组合达标，${fail} 组合不足 4.5`)
browser.kill()
process.exit(fail ? 1 : 0)
