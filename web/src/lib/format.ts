const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

export function formatDate(iso: string, style: 'full' | 'short' | 'month' = 'full'): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month) return iso
  const m = Number(month)
  if (style === 'short') return day ? `${month}.${day}` : month
  if (style === 'month') return `${m} 月`
  if (!day) return `${year} 年 ${m} 月`
  return `${year} 年 ${m} 月 ${Number(day)} 日`
}

/**
 * 时间戳 → 本地时区的 YYYY-MM-DD。
 * 不要用 `toISOString().slice(0, 10)`：那是 UTC，东八区凌晨 0-8 点会显示成前一天。
 */
export function localDateStamp(value: number | Date = Date.now()): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatMonth(month: string): string {
  const index = Number(month) - 1
  return MONTHS[index] ?? month
}

export function formatCount(value: number): string {
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return String(value)
}

export function readingTime(minutes: number): string {
  return minutes < 60 ? `${minutes} 分钟` : `${(minutes / 60).toFixed(1)} 小时`
}
