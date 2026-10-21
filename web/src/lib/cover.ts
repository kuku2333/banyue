/** 稳定的字符串散列，用于给每篇文章生成固定的封面配色与构图 */
export function hashCode(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

/**
 * 程序化封面：同一个 slug 永远得到同一张图。
 * 三种构图（轨道 / 斜线 / 折线）按 hash 取模，配色落在青绿到蓝紫之间。
 */
export function coverSvg(slug: string): string {
  const hash = hashCode(slug)
  const hue = 158 + (hash % 58)
  const hue2 = 196 + ((hash >>> 6) % 56)
  const variant = hash % 3
  const uid = `cv${hash.toString(36)}`
  const c1 = `hsla(${hue},72%,58%,`
  const c2 = `hsla(${hue2},78%,64%,`

  let art = ''
  if (variant === 0) {
    art =
      `<circle cx="200" cy="62" r="64" fill="${c1}.16)"/>` +
      `<circle cx="200" cy="62" r="64" fill="none" stroke="${c1}.46)"/>` +
      `<circle cx="200" cy="62" r="94" fill="none" stroke="${c1}.2)" stroke-dasharray="3 8"/>` +
      `<circle cx="200" cy="62" r="124" fill="none" stroke="${c2}.14)"/>` +
      `<circle cx="128" cy="140" r="3" fill="${c1}.9)"/>` +
      `<circle cx="128" cy="140" r="13" fill="${c1}.18)"/>`
  } else if (variant === 1) {
    let lines = ''
    for (let i = -4; i < 12; i++) {
      lines += `<line x1="${i * 34}" y1="0" x2="${i * 34 + 74}" y2="200" stroke="${c1}.11)"/>`
    }
    art =
      lines +
      `<rect x="30" y="118" width="150" height="1" fill="${c1}.3)"/>` +
      `<path d="M30 118 L96 58 L150 86 L228 26" fill="none" stroke="${c2}.55)" stroke-width="1.6"/>` +
      `<circle cx="228" cy="26" r="4.5" fill="${c2}.85)"/>` +
      `<circle cx="228" cy="26" r="11" fill="none" stroke="${c2}.3)"/>`
  } else {
    let grid = ''
    for (let i = 1; i < 6; i++) {
      grid += `<line x1="${i * 34}" y1="0" x2="${i * 34}" y2="200" stroke="${c1}.07)"/>`
      grid += `<line x1="0" y1="${i * 34}" x2="400" y2="${i * 34}" stroke="${c1}.05)"/>`
    }
    art =
      grid +
      `<path d="M-10 150 Q80 96 168 128 T400 74" fill="none" stroke="${c1}.42)" stroke-width="1.4"/>` +
      `<path d="M-10 172 Q96 124 190 152 T400 104" fill="none" stroke="${c2}.3)" stroke-width="1.2"/>` +
      `<circle cx="168" cy="128" r="4" fill="${c1}.9)"/>`
  }

  return (
    `<svg class="cover-svg" viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">` +
    `<defs><linearGradient id="${uid}" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}.20)"/><stop offset="1" stop-color="${c2}.06)"/></linearGradient></defs>` +
    `<rect width="400" height="200" fill="url(#${uid})"/>` +
    `<rect width="400" height="200" fill="none" stroke="${c1}.16)"/>` +
    art +
    `</svg>`
  )
}
