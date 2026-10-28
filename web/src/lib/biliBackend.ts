/**
 * B站 代理后端地址。
 *
 * 为什么需要这层：
 * 服务器（云机房 IP）访问 api.bilibili.com 会被风控挡掉（HTTP 412），
 * 而用户自己的电脑（家庭宽带）是通的。所以线上页面把 B站请求转给本机后端
 * 处理 —— 浏览器里的 127.0.0.1 就是用户自己这台电脑。
 *
 * 代价：本机后端必须开着。没开时这里负责给出人话提示，而不是让它变成
 * 一个莫名的「网络不通」。
 */
const LOCAL = 'http://127.0.0.1:8787'
const STORAGE_KEY = 'banyue:bili-backend'

function isLocalPage(): boolean {
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1'
}

let cached: string | null = null

/** B站接口的基础地址，末尾不带斜杠；空串表示同源 */
export function biliBase(): string {
  if (cached !== null) return cached
  const saved = localStorage.getItem(STORAGE_KEY)?.trim()
  if (saved) {
    cached = saved.replace(/\/+$/, '')
    return cached
  }
  cached = isLocalPage() ? '' : LOCAL
  return cached
}

/** 把 /api/bilibili/... 变成真实可请求的地址 */
export function biliUrl(path: string): string {
  const base = biliBase()
  return base ? `${base}${path}` : path
}

/** 是否正在借用本机后端（页面不是从 localhost 打开的） */
export function biliUsingLocal(): boolean {
  return biliBase() !== ''
}

/** 本机后端没开时给的人话提示 */
export const LOCAL_DOWN_HINT =
  `B站解析需要本机后端：服务器 IP 会被 B站 风控拦截。\n` +
  `请在电脑上打开一个终端跑：\n\n` +
  `  cd E:\\projects\\blog\\server\n` +
  `  node src/index.mjs\n\n` +
  `跑起来后刷新页面重试。`

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
