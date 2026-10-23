/**
 * 歌词：解析 LRC + 从音频容器里抠出内嵌歌词。
 * 纯本地实现，不依赖语音识别（那需要几百 MB 的模型，不适合网页）。
 */

export interface LyricLine {
  /** 开始时间（秒） */
  time: number
  text: string
}

/** 解析 LRC / 纯文本歌词 */
export function parseLyrics(raw: string): LyricLine[] {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n')
  if (!text.trim()) return []

  const lines: LyricLine[] = []
  const tag = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g

  for (const row of text.split('\n')) {
    // 一行可能挂多个时间标签：[00:12.00][00:48.00]同一句
    const stamps: number[] = []
    let match: RegExpExecArray | null
    let lastEnd = 0
    tag.lastIndex = 0
    while ((match = tag.exec(row)) !== null) {
      const min = Number(match[1] ?? 0)
      const sec = Number(match[2] ?? 0)
      const fracRaw = match[3] ?? '0'
      // 两位是百分秒，三位是毫秒
      const frac = fracRaw.length === 3 ? Number(fracRaw) / 1000 : Number(fracRaw.padEnd(2, '0')) / 100
      stamps.push(min * 60 + sec + frac)
      lastEnd = match.index + match[0].length
    }
    const content = row.slice(lastEnd).trim()
    if (!stamps.length) {
      // 没有时间标签的行：纯文本歌词，按顺序占位（时间设为 -1 表示无时间轴）
      if (content) lines.push({ time: -1, text: content })
      continue
    }
    if (!content) continue
    for (const time of stamps) lines.push({ time, text: content })
  }

  const timed = lines.filter((item) => item.time >= 0).sort((a, b) => a.time - b.time)
  return timed.length ? timed : lines
}

/** 当前时间应该显示第几行（-1 表示还没到第一句） */
export function activeLineIndex(lines: LyricLine[], current: number): number {
  if (!lines.length) return -1
  if (lines[0]!.time < 0) {
    // 无时间轴：按播放进度均分
    return -1
  }
  let index = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.time <= current + 0.15) index = i
    else break
  }
  return index
}

/* ---------------- 内嵌歌词提取（MP3 / FLAC / M4A） ---------------- */

function readAscii(view: DataView, offset: number, length: number): string {
  let out = ''
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i))
  return out
}

/** 去掉 UTF-8 BOM、结尾的 \0、多余空白 */
function clean(raw: string): string {
  return raw.replace(/^\uFEFF/, '').replace(/\0+$/g, '').trim()
}

/** MP3：ID3v2 里的 USLT（非同步歌词）帧 */
function extractFromId3(view: DataView, bytes: Uint8Array): string {
  if (readAscii(view, 0, 3) !== 'ID3') return ''
  const major = view.getUint8(3)
  const flags = view.getUint8(5)
  const size =
    ((view.getUint8(6) & 0x7f) << 21) |
    ((view.getUint8(7) & 0x7f) << 14) |
    ((view.getUint8(8) & 0x7f) << 7) |
    (view.getUint8(9) & 0x7f)
  let offset = 10
  // 扩展头
  if (flags & 0x40) {
    const extSize =
      ((view.getUint8(offset) & 0x7f) << 21) |
      ((view.getUint8(offset + 1) & 0x7f) << 14) |
      ((view.getUint8(offset + 2) & 0x7f) << 7) |
      (view.getUint8(offset + 3) & 0x7f)
    offset += 4 + extSize
  }
  const end = Math.min(bytes.length, 10 + size)

  while (offset + 10 < end) {
    const id = readAscii(view, offset, 4)
    if (!/^[A-Z0-9]{4}$/.test(id)) break
    const frameSize =
      major >= 4
        ? ((view.getUint8(offset + 4) & 0x7f) << 21) |
          ((view.getUint8(offset + 5) & 0x7f) << 14) |
          ((view.getUint8(offset + 6) & 0x7f) << 7) |
          (view.getUint8(offset + 7) & 0x7f)
        : (view.getUint8(offset + 4) << 24) |
          (view.getUint8(offset + 5) << 16) |
          (view.getUint8(offset + 6) << 8) |
          view.getUint8(offset + 7)
    const bodyStart = offset + 10
    if (frameSize <= 0 || bodyStart + frameSize > bytes.length) break

    if (id === 'USLT' || id === 'ULT') {
      const encoding = view.getUint8(bodyStart)
      // 跳过编码字节 + 3 字节语言 + 内容描述（以终止符结束）
      let cursor = bodyStart + 4
      if (encoding === 1 || encoding === 2) {
        // UTF-16：直到 00 00
        while (cursor + 1 < bodyStart + frameSize) {
          if (view.getUint8(cursor) === 0 && view.getUint8(cursor + 1) === 0) {
            cursor += 2
            break
          }
          cursor += 2
        }
        const slice = bytes.subarray(cursor, bodyStart + frameSize)
        return clean(new TextDecoder('utf-16le').decode(slice))
      }
      while (cursor < bodyStart + frameSize && view.getUint8(cursor) !== 0) cursor++
      cursor++
      const slice = bytes.subarray(cursor, bodyStart + frameSize)
      return clean(new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(slice))
    }
    offset = bodyStart + frameSize
  }
  return ''
}

/** FLAC：VORBIS_COMMENT 里的 LYRICS / UNSYNCEDLYRICS 字段 */
function extractFromFlac(view: DataView, bytes: Uint8Array): string {
  if (readAscii(view, 0, 4) !== 'fLaC') return ''
  let offset = 4
  while (offset + 4 <= bytes.length) {
    const header = view.getUint8(offset)
    const type = header & 0x7f
    const last = (header & 0x80) !== 0
    const length = (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3)
    const body = offset + 4
    if (type === 4) {
      // VORBIS_COMMENT
      let cursor = body
      const vendorLen = view.getUint32(cursor, true)
      cursor += 4 + vendorLen
      if (cursor + 4 > bytes.length) return ''
      const count = view.getUint32(cursor, true)
      cursor += 4
      for (let i = 0; i < count && cursor + 4 <= bytes.length; i++) {
        const itemLen = view.getUint32(cursor, true)
        cursor += 4
        const item = new TextDecoder('utf-8').decode(bytes.subarray(cursor, cursor + itemLen))
        cursor += itemLen
        const eq = item.indexOf('=')
        if (eq < 0) continue
        const key = item.slice(0, eq).toUpperCase()
        if (key === 'LYRICS' || key === 'UNSYNCEDLYRICS' || key === 'UNSYNCED LYRICS') {
          return clean(item.slice(eq + 1))
        }
      }
      return ''
    }
    offset = body + length
    if (last) break
  }
  return ''
}

/** MP4 / M4A：mvhd 之外找 ©lyr atom */
function extractFromMp4(view: DataView, bytes: Uint8Array): string {
  const text = readAscii(view, 0, 8)
  if (!text.includes('ftyp') && !text.includes('moov')) return ''

  const find = (start: number, end: number, name: string): string => {
    let offset = start
    while (offset + 8 <= end) {
      const size = view.getUint32(offset)
      const type = readAscii(view, offset + 4, 4)
      if (size < 8) break
      const body = offset + 8
      if (type === name) {
        // ©lyr 内容：4 字节版本 + 2 字节长度 + 2 字节语言 + 文本
        const len = view.getUint16(body + 4)
        const start2 = body + 8
        return clean(new TextDecoder('utf-8').decode(bytes.subarray(start2, start2 + len)))
      }
      if (['moov', 'udta', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
        const inner = find(body, offset + size, name)
        if (inner) return inner
      }
      offset += size
    }
    return ''
  }
  return find(0, bytes.length, '\u00A9lyr')
}

/** 从音频文件里尝试抠出内嵌歌词；没有就返回空串 */
export async function readEmbeddedLyrics(blob: Blob): Promise<string> {
  try {
    // 歌词一般在头部元数据里，读前 2MB 足够
    const head = await blob.slice(0, Math.min(blob.size, 2 * 1024 * 1024)).arrayBuffer()
    const bytes = new Uint8Array(head)
    const view = new DataView(head)
    if (bytes.length < 12) return ''

    const magic = readAscii(view, 0, 4)
    if (magic === 'ID3\u0000' || magic.startsWith('ID3')) return extractFromId3(view, bytes)
    if (magic === 'fLaC') return extractFromFlac(view, bytes)
    // m4a/mp4：ftyp 一般在第 4 字节
    if (bytes.length > 12 && readAscii(view, 4, 4) === 'ftyp') return extractFromMp4(view, bytes)
    return ''
  } catch {
    return ''
  }
}

/** 判断文件名是不是歌词文件 */
export function isLyricFile(name: string): boolean {
  return /\.(lrc|txt)$/i.test(name)
}
