import { describe, expect, it } from 'vitest'
import { activeLineIndex, parseLyrics, readEmbeddedLyrics } from '@/lib/lyrics'

/** 造一个带 ID3v2.3 USLT 歌词帧的最小 MP3 */
function makeMp3Bytes(lyrics: string): Uint8Array {
  const enc = new TextEncoder()
  const payload = new Uint8Array([
    3, // UTF-8
    0x63,
    0x68,
    0x69, // 'chi'
    0, // 空描述终止符
    ...enc.encode(lyrics),
  ])
  const frame = new Uint8Array(10 + payload.length)
  frame.set([0x55, 0x53, 0x4c, 0x54], 0) // 'USLT'
  const size = payload.length
  frame[4] = (size >>> 24) & 0xff
  frame[5] = (size >>> 16) & 0xff
  frame[6] = (size >>> 8) & 0xff
  frame[7] = size & 0xff
  frame.set(payload, 10)

  const header = new Uint8Array(10)
  header.set([0x49, 0x44, 0x33], 0) // 'ID3'
  header[3] = 3
  header[4] = 0
  header[5] = 0
  header[6] = (frame.length >> 21) & 0x7f
  header[7] = (frame.length >> 14) & 0x7f
  header[8] = (frame.length >> 7) & 0x7f
  header[9] = frame.length & 0x7f

  const out = new Uint8Array(header.length + frame.length + 4096)
  out.set(header, 0)
  out.set(frame, header.length)
  return out
}

describe('LRC 解析', () => {
  it('按时间轴解析并排序', () => {
    const lines = parseLyrics('[00:10.00]第三句\n[00:00.00]第一句\n[00:05.50]第二句')
    expect(lines.map((l) => l.text)).toEqual(['第一句', '第二句', '第三句'])
    expect(lines[0]!.time).toBe(0)
    expect(lines[1]!.time).toBeCloseTo(5.5, 3)
    expect(lines[2]!.time).toBe(10)
  })

  it('一行挂多个时间标签', () => {
    const lines = parseLyrics('[00:01.00][00:20.00]重复的一句')
    expect(lines).toHaveLength(2)
    expect(lines.map((l) => l.time)).toEqual([1, 20])
  })

  it('支持三位毫秒', () => {
    const lines = parseLyrics('[00:01.250]毫秒')
    expect(lines[0]!.time).toBeCloseTo(1.25, 3)
  })

  it('没有时间标签时按纯文本保留', () => {
    const lines = parseLyrics('第一行\n第二行')
    expect(lines.map((l) => l.text)).toEqual(['第一行', '第二行'])
    expect(lines[0]!.time).toBe(-1)
  })

  it('空歌词返回空数组', () => {
    expect(parseLyrics('')).toEqual([])
    expect(parseLyrics('   \n  ')).toEqual([])
  })
})

describe('当前行计算', () => {
  const lines = parseLyrics('[00:00.00]A\n[00:05.00]B\n[00:10.00]C')

  it('按时间找到当前行', () => {
    expect(activeLineIndex(lines, 0)).toBe(0)
    expect(activeLineIndex(lines, 5.1)).toBe(1)
    // 有 0.15s 提前量：9.99 已经算进入第三句
    expect(activeLineIndex(lines, 9.8)).toBe(1)
    expect(activeLineIndex(lines, 9.99)).toBe(2)
    expect(activeLineIndex(lines, 30)).toBe(2)
  })

  it('无时间轴返回 -1', () => {
    expect(activeLineIndex(parseLyrics('纯文本'), 5)).toBe(-1)
  })
})

describe('内嵌歌词提取', () => {
  /** jsdom 的 Blob 没实现 arrayBuffer()，用最小等价替身（真实浏览器已验证可行） */
  function fakeBlob(bytes: Uint8Array): Blob {
    return {
      size: bytes.byteLength,
      slice(start = 0, end = bytes.byteLength) {
        return fakeBlob(bytes.slice(start, end))
      },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      },
    } as unknown as Blob
  }

  it('能读出 MP3 的 USLT 歌词', async () => {
    const text = '[00:00.00]测试第一句\n[00:05.00]测试第二句\n'
    const got = await readEmbeddedLyrics(fakeBlob(makeMp3Bytes(text)))
    expect(got).toContain('测试第一句')
    expect(got).toContain('测试第二句')
  })

  it('没有歌词的文件返回空串', async () => {
    expect(await readEmbeddedLyrics(fakeBlob(new Uint8Array(2048)))).toBe('')
  })
})
