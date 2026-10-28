/**
 * B站 代理后端地址。
 *
 * 历史：服务器 IP 曾被误判为「被 B站 封禁」，于是做了一套「线上页面把 B站
 * 请求转给本机后端」的机制。后来查明真正的原因是缺 buvid 设备指纹（后端
 * 补上 buvid3+buvid4 后服务器直接可用），所以默认又回到同源。
 *
 * 保留这层的目的：万一哪天服务器又解析不了，用户仍可一键切到本机后端。
 * 默认同源，不增加任何额外配置。
 */
const LOCAL = 'http://127.0.0.1:8787'
const STORAGE_KEY = 'banyue:bili-backend'

function isLocalPage(): boolean {
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}

let cached: string | null = null

/** B站接口的基础地址，末尾不带斜杠；空串表示同源（默认） */
export function biliBase(): string {
  if (cached !== null) return cached
  const saved = localStorage.getItem(STORAGE_KEY)?.trim()
  cached = saved ? saved.replace(/\/+$/, '') : ''
  return cached
}

/** 把 /api/bilibili/... 变成真实可请求的地址 */
export function biliUrl(path: string): string {
  const base = biliBase()
  return base ? `${base}${path}` : path
}

/** 是否正在借用本机后端（只有用户手动切换时才为 true） */
export function biliUsingLocal(): boolean {
  return biliBase() !== ''
}

/** 本机后端没开时给的人话提示 */
export const LOCAL_DOWN_HINT =
  `已切换到本机后端，但它没有响应。\n` +
  `请先在本机终端启动：\n\n` +
  `  cd E:\\projects\\blog\\server\n` +
  `  node src/index.mjs\n\n` +
  `或者点上面「恢复默认」改回用服务器解析。`

/** 本机后端是否活着 */
export async function probeLocalBili(): Promise<boolean> {
  if (!biliBase()) return true
  try {
    const res = await fetch(`${LOCAL}/api/bilibili/ping`, { method: 'GET' })
    return res.ok
  } catch {
    return false
  }
}

export function setBiliBackend(origin: string): void {
  const value = origin.trim().replace(/\/+$/, '')
  if (value) localStorage.setItem(STORAGE_KEY, value)
  else localStorage.removeItem(STORAGE_KEY)
  cached = null
}

export function resetBiliBackend(): void {
  localStorage.removeItem(STORAGE_KEY)
  cached = null
}

/** 页面是否从 localhost 打开（本地开发时提示文案不同） */
export function isLocalDevPage(): boolean {
  return isLocalPage()
}
