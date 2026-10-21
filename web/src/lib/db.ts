import Dexie, { type Table } from 'dexie'
import type { Chapter } from './books'

export interface BookRecord {
  id: string
  title: string
  author: string
  format: 'txt' | 'md'
  size: number
  words: number
  chapterCount: number
  encoding: string
  createdAt: number
  lastReadAt?: number
  lastChapter?: number
  lastOffset?: number
  progress?: number
}

export interface TextRecord {
  bookId: string
  chapters: Chapter[]
}

export interface TrackRecord {
  id: string
  title: string
  artist: string
  size: number
  hash: string
  createdAt: number
  data?: Blob
}

class BanyueDatabase extends Dexie {
  books!: Table<BookRecord, string>
  texts!: Table<TextRecord, string>
  tracks!: Table<TrackRecord, string>

  constructor() {
    super('banyue-reader')
    this.version(1).stores({
      books: 'id, createdAt, lastReadAt',
      texts: 'bookId',
      tracks: 'id, createdAt, hash',
    })
  }
}

let instance: BanyueDatabase | null = null

/** 延迟创建，保证 SSR/测试环境不 import 就连接数据库 */
export function db(): BanyueDatabase {
  if (!instance) instance = new BanyueDatabase()
  return instance
}

export async function putBook(book: BookRecord, chapters: Chapter[]): Promise<void> {
  await db().transaction('rw', db().books, db().texts, async () => {
    await db().books.put(book)
    await db().texts.put({ bookId: book.id, chapters })
  })
}

export async function deleteBook(id: string): Promise<void> {
  await db().transaction('rw', db().books, db().texts, async () => {
    await db().books.delete(id)
    await db().texts.delete(id)
  })
}

export async function listBooks(): Promise<BookRecord[]> {
  return db().books.orderBy('createdAt').reverse().toArray()
}

export async function getBook(id: string): Promise<{ book: BookRecord; chapters: Chapter[] } | null> {
  const book = await db().books.get(id)
  if (!book) return null
  const text = await db().texts.get(id)
  return { book, chapters: text?.chapters ?? [] }
}

export async function saveProgress(
  id: string,
  chapter: number,
  offset: number,
  progress: number,
): Promise<void> {
  await db().books.update(id, {
    lastChapter: chapter,
    lastOffset: offset,
    progress,
    lastReadAt: Date.now(),
  })
}
