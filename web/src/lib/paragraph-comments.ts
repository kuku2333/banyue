import { api } from '@/lib/api'
import {
  addSongNote,
  deleteSongNote,
  listSongNotes,
  type LocalSongNote,
} from '@/lib/db'

/** 云端段落评论（公开，带作者） */
export interface ParagraphComment {
  id: string
  paragraph: number
  body: string
  createdAt: number
  owner: { username: string; displayName: string }
  mine: boolean
  local?: boolean
}

export type ParagraphKey = string

export function paragraphKey(chapter: number, paragraph: number): ParagraphKey {
  return `${chapter}:${paragraph}`
}

function noteKey(bookKey: string, chapter: number, paragraph: number): string {
  return `pc:${bookKey}:${chapter}:${paragraph}`
}

/** 本地（未登录）评论，借用 songNotes 表，trackId 形如 pc:<bookKey>:<chapter>:<para> */
function toLocalComment(note: LocalSongNote, paragraph: number): ParagraphComment {
  return {
    id: note.id,
    paragraph,
    body: note.body,
    createdAt: note.createdAt,
    owner: { username: '', displayName: '仅本机' },
    mine: true,
    local: true,
  }
}

/** 拉某章的云端段落评论；没登录/网络失败返回空（本地评论照常可用） */
export async function fetchChapterComments(bookKey: string, chapter: number): Promise<ParagraphComment[]> {
  try {
    const data = await api<{ comments: ParagraphComment[] }>(
      `/api/books/${encodeURIComponent(bookKey)}/paragraphs/${chapter}/comments`,
    )
    return data.comments ?? []
  } catch {
    return []
  }
}

/** 某段的本地评论（所有书共用 songNotes，按 noteKey 过滤） */
export async function fetchLocalParagraphNotes(
  bookKey: string,
  chapter: number,
  paragraphs: number[],
): Promise<ParagraphComment[]> {
  const result: ParagraphComment[] = []
  for (const paragraph of paragraphs) {
    const notes = await listSongNotes(noteKey(bookKey, chapter, paragraph))
    for (const note of notes) result.push(toLocalComment(note, paragraph))
  }
  return result
}

/** 发一条段落评论：登录走云端公开，未登录存本机 */
export async function postParagraphComment(
  bookKey: string,
  chapter: number,
  paragraph: number,
  body: string,
  loggedIn: boolean,
): Promise<void> {
  if (loggedIn) {
    await api(`/api/books/${encodeURIComponent(bookKey)}/paragraphs/${chapter}/comments`, {
      method: 'POST',
      body: { paragraph, body },
    })
    return
  }
  await addSongNote({
    id: `${noteKey(bookKey, chapter, paragraph)}:${Date.now().toString(36)}`,
    trackId: noteKey(bookKey, chapter, paragraph),
    body,
    createdAt: Date.now(),
  })
}

/** 删一条段落评论（本地或云端） */
export async function deleteParagraphComment(comment: ParagraphComment): Promise<void> {
  if (comment.local) {
    await deleteSongNote(comment.id)
    return
  }
  await api(`/api/paragraph-comments/${encodeURIComponent(comment.id)}`, { method: 'DELETE' })
}
