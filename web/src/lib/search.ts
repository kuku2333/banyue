// 全站搜索：把文章、标签、书架、音乐统一成一份可检索的索引。
// 静态内容（文章/标签）同步可得；书架和音乐要读 IndexedDB 与云端，
// 所以索引是异步构建的，调用方打开搜索框时构建一次并缓存。
import { posts, tagStats } from '@/lib/content'
import { listBooks, listTracks } from '@/lib/db'
import { assetUrl, listAssets } from '@/lib/cloud'
import type { Track } from '@/lib/music'

export type SearchKind = 'post' | 'book' | 'track' | 'tag'

export interface SearchItem {
  /** 全局唯一键，用于列表 key 与键盘选中 */
  key: string
  kind: SearchKind
  title: string
  subtitle: string
  /** 命中范围（小写），排序与过滤都基于它 */
  haystack: string
  /** 点开之后去哪里；歌曲没有 route，直接播放 */
  route?: string
  track?: Track
  score: number
}

export const KIND_LABEL: Record<SearchKind, string> = {
  post: '文章',
  book: '书',
  track: '音乐',
  tag: '标签',
}

/** 索引里的原始条目，还没算分 */
interface Entry {
  key: string
  kind: SearchKind
  title: string
  subtitle: string
  body: string
  route?: string
  track?: Track
}

function toEntry(entry: Entry): Entry {
  return entry
}

/**
 * 打分：标题精确 > 标题前缀 > 标题包含 > 副标题包含 > 正文包含。
 * 这样「小王子」会排在正文里偶然提到它的文章前面。
 */
function scoreOf(query: string, entry: Entry): number {
  const title = entry.title.toLowerCase()
  const subtitle = entry.subtitle.toLowerCase()
  if (title === query) return 120
  if (title.startsWith(query)) return 100
  if (title.includes(query)) return 80
  if (subtitle.includes(query)) return 40
  if (entry.body.toLowerCase().includes(query)) return 15
  return 0
}

/** 静态部分：文章 + 标签（同步，立即可用） */
export function staticEntries(visiblePosts = posts): Entry[] {
  const out: Entry[] = visiblePosts.map((post) =>
    toEntry({
      key: `post:${post.slug}`,
      kind: 'post',
      title: post.title,
      subtitle: `${post.date} · ${post.tags.join(' / ') || '无标签'}`,
      body: `${post.excerpt} ${post.tags.join(' ')} ${post.html}`,
      route: `/post/${post.slug}`,
    }),
  )
  for (const tag of tagStats(visiblePosts)) {
    out.push(
      toEntry({
        key: `tag:${tag.name}`,
        kind: 'tag',
        title: `#${tag.name}`,
        subtitle: `${tag.count} 篇`,
        body: tag.name,
        route: `/tag/${encodeURIComponent(tag.name)}`,
      }),
    )
  }
  return out
}

/** 动态部分：本地书 + 云端书 + 本地歌 + 云端歌。任何一项失败都只跳过它。 */
export async function libraryEntries(): Promise<Entry[]> {
  const out: Entry[] = []

  try {
    const books = await listBooks()
    for (const book of books) {
      out.push(
        toEntry({
          key: `book:${book.id}`,
          kind: 'book',
          title: book.title,
          subtitle: `${book.author || '未知作者'} · ${book.chapterCount} 章 · 本地`,
          body: `${book.author} ${book.format}`,
          route: `/read/${book.id}`,
        }),
      )
    }
  } catch {
    /* IndexedDB 不可用时跳过本地书 */
  }

  try {
    const assets = await listAssets('book')
    for (const asset of assets) {
      out.push(
        toEntry({
          key: `cloudbook:${asset.id}`,
          kind: 'book',
          title: asset.title,
          subtitle: `${asset.subtitle || '未知作者'} · 云端`,
          body: asset.subtitle,
          route: '/shelf',
        }),
      )
    }
  } catch {
    /* 未登录或离线时没有云端书 */
  }

  try {
    const tracks = await listTracks()
    for (const item of tracks) {
      out.push(
        toEntry({
          key: `track:${item.id}`,
          kind: 'track',
          title: item.title,
          subtitle: `${item.artist || '本地文件'} · 本地`,
          body: item.artist,
          track: {
            id: item.id,
            title: item.title,
            artist: item.artist || '本地文件',
            source: 'local',
            local: true,
            hash: item.hash,
            art: item.cover || undefined,
            lyrics: item.lyrics || undefined,
          },
        }),
      )
    }
  } catch {
    /* 跳过 */
  }

  try {
    const assets = await listAssets('track')
    for (const asset of assets) {
      out.push(
        toEntry({
          key: `cloudtrack:${asset.id}`,
          kind: 'track',
          title: asset.title,
          subtitle: `${asset.subtitle || '云端上传'} · 云端`,
          body: asset.subtitle,
          track: {
            id: `cloud-${asset.id}`,
            title: asset.title,
            artist: asset.subtitle || '云端上传',
            source: 'cloud',
            previewUrl: assetUrl(asset.id),
            hash: asset.hash,
            art: asset.cover || undefined,
          },
        }),
      )
    }
  } catch {
    /* 跳过 */
  }

  return out
}

/** 把索引条目按关键词过滤排序，返回可直接渲染的结果 */
export function runSearch(query: string, entries: Entry[], limit = 12): SearchItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: SearchItem[] = []
  for (const entry of entries) {
    const score = scoreOf(q, entry)
    if (score === 0) continue
    hits.push({
      key: entry.key,
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle,
      haystack: entry.body.toLowerCase(),
      route: entry.route,
      track: entry.track,
      score,
    })
  }
  // 同分时文章优先，其次书、音乐、标签，保证结果稳定
  const order: Record<SearchKind, number> = { post: 0, book: 1, track: 2, tag: 3 }
  hits.sort((a, b) => b.score - a.score || order[a.kind] - order[b.kind])
  return hits.slice(0, limit)
}

export type { Entry as SearchEntry }
