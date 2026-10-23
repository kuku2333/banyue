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
  /** 唱片封面（dataURL，可选） */
  cover?: string
  /** 歌词原文（LRC 或纯文本，可选） */
  lyrics?: string
}

export interface DraftRecord {
  id: string
  title: string
  content: string
  tags: string
  excerpt: string
  createdAt: number
  updatedAt: number
}

export interface LocalBookmark {
  id: string
  bookKey: string
  chapter: number
  chapterTitle: string
  ratio: number
  note: string
  createdAt: number
}

export interface LocalSongNote {
  id: string
  trackId: string
  body: string
  createdAt: number
}

class BanyueDatabase extends Dexie {
  books!: Table<BookRecord, string>
  texts!: Table<TextRecord, string>
  tracks!: Table<TrackRecord, string>
  drafts!: Table<DraftRecord, string>
  localBookmarks!: Table<LocalBookmark, string>
  songNotes!: Table<LocalSongNote, string>

  constructor() {
    super('banyue-reader')
    this.version(1).stores({
      books: 'id, createdAt, lastReadAt',
      texts: 'bookId',
      tracks: 'id, createdAt, hash',
    })
    this.version(2).stores({
      drafts: 'id, updatedAt',
    })
    this.version(3).stores({
      localBookmarks: 'id, bookKey',
      songNotes: 'id, trackId',
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

/* ---------------- 本地音乐 ---------------- */

export async function addTrack(record: TrackRecord): Promise<void> {
  await db().tracks.put(record)
}

export async function listTracks(): Promise<TrackRecord[]> {
  return db().tracks.orderBy('createdAt').reverse().toArray()
}

export async function findTrackByHash(hash: string): Promise<TrackRecord | undefined> {
  return db().tracks.where('hash').equals(hash).first()
}

export async function getTrackBlob(id: string): Promise<Blob | undefined> {
  return (await db().tracks.get(id))?.data
}

export async function deleteTrack(id: string): Promise<void> {
  await db().tracks.delete(id)
}

/* ---------------- 写作台草稿 ---------------- */

export async function listDrafts(): Promise<DraftRecord[]> {
  return db().drafts.orderBy('updatedAt').reverse().toArray()
}

export async function getDraft(id: string): Promise<DraftRecord | undefined> {
  return db().drafts.get(id)
}

export async function putDraft(draft: DraftRecord): Promise<void> {
  await db().drafts.put(draft)
}

export async function deleteDraft(id: string): Promise<void> {
  await db().drafts.delete(id)
}

/* ---------------- 本地书签与本地评论（不上传） ---------------- */

export async function listLocalBookmarks(bookKey: string): Promise<LocalBookmark[]> {
  return db().localBookmarks.where('bookKey').equals(bookKey).sortBy('chapter')
}

export async function addLocalBookmark(bookmark: LocalBookmark): Promise<void> {
  await db().localBookmarks.put(bookmark)
}

export async function deleteLocalBookmark(id: string): Promise<void> {
  await db().localBookmarks.delete(id)
}

export async function listSongNotes(trackId: string): Promise<LocalSongNote[]> {
  return (await db().songNotes.where('trackId').equals(trackId).toArray()).sort((a, b) => b.createdAt - a.createdAt)
}

export async function addSongNote(note: LocalSongNote): Promise<void> {
  await db().songNotes.put(note)
}

export async function deleteSongNote(id: string): Promise<void> {
  await db().songNotes.delete(id)
}
