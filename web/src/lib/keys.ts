import type { Track } from './music'

/** 书在「公开世界」里的键：同名同字数的书会落到同一个键上，方便不同设备对上 */
export function bookKeyFor(book: { title: string; author?: string | null; words: number }): string {
  const title = book.title.trim().toLowerCase().replace(/\s+/g, '')
  const author = (book.author ?? '').trim().toLowerCase().replace(/\s+/g, '')
  let hash = 0
  const input = `${title}|${author}|${book.words}`
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return `book-${Math.abs(hash).toString(36)}`
}

/** 云端歌才有公开评论；本地文件用本地笔记 */
export function isCloudTrack(track: Track): boolean {
  return !track.local && track.id.startsWith('apple-')
}

export function trackKeyFor(track: Track): string {
  return track.id
}
