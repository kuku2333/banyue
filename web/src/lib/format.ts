const MONTHS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二']

export function formatDate(iso: string, style: 'full' | 'short' | 'month' = 'full'): string {
  const [year, month, day] = iso.split('-')
  if (!year || !month) return iso
  const m = Number(month)
  if (style === 'short') return `${month}.${day}`
  if (style === 'month') return `${m} 月`
  return `${year} 年 ${m} 月 ${Number(day)} 日`
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
