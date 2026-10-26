// 数据备份：把散落在 IndexedDB、localStorage 和服务端的东西打成一份 JSON。
//
// 音频/书籍的二进制原文不进去（动辄几百 MB，JSON 装不下也传不动），
// 只保留元数据与进度，并在文件里标注哪些没有备份、怎么手动补。
import {
  listBooks,
  listDrafts,
  listMathNotebooks,
  listMathPages,
  listSongNotes,
  listTracks,
  listLocalBookmarks,
} from '@/lib/db'
import { listAssets } from '@/lib/cloud'
import { getPlaylist, listPlaylists, type PlaylistDetail } from '@/lib/playlists'
import type { MathPage } from '@/lib/db'

export const BACKUP_VERSION = 1

export interface BackupSong {
  title: string
  artist: string
  size: number
  hash: string
  createdAt: number
  hasCover: boolean
  hasLyrics: boolean
}

export interface BackupBook {
  title: string
  author: string
  format: string
  words: number
  chapterCount: number
  createdAt: number
  progress: number
  lastChapter: number
}

export interface BackupMathNotebook {
  name: string
  createdAt: number
  updatedAt: number
  pages: MathPage[]
}

export interface BackupBundle {
  version: number
  exportedAt: string
  /** 浏览器导出的东西没有服务器归属，这里只记来源域名，便于区分 */
  origin: string
  /** localStorage 里所有 banyue: 前缀的键 */
  preferences: Record<string, unknown>
  drafts: unknown[]
  books: BackupBook[]
  songs: BackupSong[]
  bookmarks: unknown[]
  songNotes: unknown[]
  mathNotebooks: BackupMathNotebook[]
  /** 云端我自己上传的资产清单 */
  cloudAssets: { kind: string; title: string; size: number; createdAt: number }[]
  playlists: PlaylistDetail[]
  /** 明确告诉用户哪些东西没在包里 */
  notIncluded: string[]
}

function readPreferences(): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith('banyue:')) continue
      const raw = localStorage.getItem(key)
      if (raw === null) continue
      try {
        out[key] = JSON.parse(raw)
      } catch {
        out[key] = raw
      }
    }
  } catch {
    /* 隐私模式下 localStorage 可能不可用 */
  }
  return out
}

/** 收集全部可备份内容。每一块单独兜底，不让一项失败拖垮整包。 */
export async function collectBackup(): Promise<BackupBundle> {
  const notIncluded: string[] = []

  let drafts: unknown[] = []
  try {
    drafts = await listDrafts()
  } catch {
    notIncluded.push('草稿（读取失败）')
  }

  let books: BackupBook[] = []
  try {
    books = (await listBooks()).map((book) => ({
      title: book.title,
      author: book.author,
      format: book.format,
      words: book.words,
      chapterCount: book.chapterCount,
      createdAt: book.createdAt,
      progress: book.progress ?? 0,
      lastChapter: book.lastChapter ?? 0,
    }))
    if (books.length) notIncluded.push('书籍正文（体积大，请用「导出到本地」逐本下载）')
  } catch {
    notIncluded.push('书架（读取失败）')
  }

  let songs: BackupSong[] = []
  try {
    songs = (await listTracks()).map((item) => ({
      title: item.title,
      artist: item.artist,
      size: item.size,
      hash: item.hash,
      createdAt: item.createdAt,
      hasCover: Boolean(item.cover),
      hasLyrics: Boolean(item.lyrics),
    }))
    if (songs.length) notIncluded.push('音乐音频文件（体积大，请到「听歌 → 本地音乐」逐个下载）')
  } catch {
    notIncluded.push('本地音乐（读取失败）')
  }

  let bookmarks: unknown[] = []
  let songNotes: unknown[] = []
  try {
    const bookIds = (await listBooks()).map((book) => book.id)
    const all: unknown[] = []
    for (const id of bookIds) all.push(...(await listLocalBookmarks(id)))
    bookmarks = all
  } catch {
    notIncluded.push('阅读书签（读取失败）')
  }
  try {
    const ids = (await listTracks()).map((item) => item.id)
    const all: unknown[] = []
    for (const id of ids) all.push(...(await listSongNotes(id)))
    songNotes = all
  } catch {
    notIncluded.push('听歌笔记（读取失败）')
  }

  const mathNotebooks: BackupMathNotebook[] = []
  try {
    for (const notebook of await listMathNotebooks()) {
      const pages = await listMathPages(notebook.id)
      mathNotebooks.push({
        name: notebook.name,
        createdAt: notebook.createdAt,
        updatedAt: notebook.updatedAt,
        pages,
      })
    }
  } catch {
    notIncluded.push('数学草稿本（读取失败）')
  }

  let cloudAssets: BackupBundle['cloudAssets'] = []
  try {
    const [books, tracks] = await Promise.all([listAssets('book'), listAssets('track')])
    cloudAssets = [...books, ...tracks]
      .filter((asset) => asset.mine)
      .map((asset) => ({
        kind: asset.kind,
        title: asset.title,
        size: asset.size,
        createdAt: asset.createdAt,
      }))
  } catch {
    /* 未登录就没有云端清单，不算失败 */
  }

  let playlists: PlaylistDetail[] = []
  try {
    const list = await listPlaylists()
    for (const summary of list.playlists) {
      try {
        playlists.push(await getPlaylist(summary.id))
      } catch {
        /* 单个歌单读不到就跳过 */
      }
    }
  } catch {
    /* 未登录 */
  }

  return {
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    origin: typeof location === 'undefined' ? 'unknown' : location.origin,
    preferences: readPreferences(),
    drafts,
    books,
    songs,
    bookmarks,
    songNotes,
    mathNotebooks,
    cloudAssets,
    playlists,
    notIncluded,
  }
}

/** 备份文件名：带上日期，方便区分多次导出 */
export function backupFileName(date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `banyue-backup-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`
}

/** 触发浏览器下载 */
export function downloadJson(data: unknown, fileName: string): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  // 立刻回收会让部分浏览器下载失败，延后释放
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

/** 备份概览：给界面显示「各有多少条」 */
export interface BackupSummary {
  drafts: number
  books: number
  songs: number
  bookmarks: number
  songNotes: number
  mathNotebooks: number
  mathPages: number
  cloudAssets: number
  playlists: number
}

export function summarize(bundle: BackupBundle): BackupSummary {
  return {
    drafts: bundle.drafts.length,
    books: bundle.books.length,
    songs: bundle.songs.length,
    bookmarks: bundle.bookmarks.length,
    songNotes: bundle.songNotes.length,
    mathNotebooks: bundle.mathNotebooks.length,
    mathPages: bundle.mathNotebooks.reduce((sum, item) => sum + item.pages.length, 0),
    cloudAssets: bundle.cloudAssets.length,
    playlists: bundle.playlists.length,
  }
}
