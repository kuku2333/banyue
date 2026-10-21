export type TrackSource = 'itunes' | 'local' | 'bili'

export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  art?: string
  previewUrl?: string
  source: TrackSource
  duration?: number
  hash?: string
  /** 本地文件不在 Track 里直接放 Blob，播放时按 id 从 IndexedDB 取 */
  local?: boolean
}

export interface Region {
  id: 'hk' | 'us' | 'jp'
  label: string
  flag: string
}

export const REGIONS: Region[] = [
  { id: 'hk', label: '华语', flag: '🇨🇳' },
  { id: 'us', label: '欧美', flag: '🇺🇸' },
  { id: 'jp', label: '日本', flag: '🇯🇵' },
]

interface RssEntry {
  'im:name': { label: string }
  'im:artist': { label: string }
  'im:image': { label: string }[]
  id: { attributes: { 'im:id': string } }
}

/** Apple Music 实时 Top 10（RSS，带 CORS） */
export async function fetchTopSongs(region: Region['id'], limit = 10): Promise<Track[]> {
  const url = `https://itunes.apple.com/${region}/rss/topsongs/limit=${limit}/json`
  const response = await fetch(url)
  if (!response.ok) throw new Error(`榜单请求失败：${response.status}`)
  const data = (await response.json()) as { feed?: { entry?: RssEntry[] | RssEntry } }
  const entries = data.feed?.entry
  const list = Array.isArray(entries) ? entries : entries ? [entries] : []
  return list.map((entry, index) => ({
    id: `apple-${entry.id?.attributes?.['im:id'] ?? index}`,
    title: entry['im:name']?.label ?? '未知曲目',
    artist: entry['im:artist']?.label ?? '',
    art: entry['im:image']?.at(-1)?.label,
    source: 'itunes' as const,
  }))
}

/** iTunes 搜索：含 30 秒试听地址 */
export async function searchSongs(term: string, region: Region['id'] = 'hk', limit = 24): Promise<Track[]> {
  const params = new URLSearchParams({
    term,
    entity: 'song',
    limit: String(limit),
    country: region,
  })
  const response = await fetch(`https://itunes.apple.com/search?${params.toString()}`)
  if (!response.ok) throw new Error(`搜索失败：${response.status}`)
  const data = (await response.json()) as { results?: RawSearchItem[] }
  return (data.results ?? []).map(toTrack).filter((track): track is Track => track !== null)
}

interface RawSearchItem {
  trackId?: number
  trackName?: string
  artistName?: string
  collectionName?: string
  artworkUrl100?: string
  previewUrl?: string
  trackTimeMillis?: number
  kind?: string
}

function toTrack(item: RawSearchItem): Track | null {
  if (!item.previewUrl || !item.trackName) return null
  return {
    id: `apple-${item.trackId ?? item.previewUrl}`,
    title: item.trackName,
    artist: item.artistName ?? '',
    album: item.collectionName,
    art: item.artworkUrl100?.replace('100x100', '200x200'),
    previewUrl: item.previewUrl,
    duration: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : undefined,
    source: 'itunes',
  }
}

/** 榜单里的曲目没有试听地址，播放前按「歌手 + 曲名」查一次 */
export async function resolvePreview(track: Track, region: Region['id'] = 'hk'): Promise<string | null> {
  if (track.previewUrl) return track.previewUrl
  const list = await searchSongs(`${track.artist} ${track.title}`.trim(), region, 5)
  const match =
    list.find((item) => item.title.includes(track.title) || track.title.includes(item.title)) ?? list[0]
  if (!match?.previewUrl) return null
  track.previewUrl = match.previewUrl
  track.art = track.art ?? match.art
  if (match.duration) track.duration = match.duration
  return match.previewUrl
}

/** 内容指纹：SHA-256 前 16 位；不安全上下文退化为「文件名 + 大小」 */
export async function fingerprint(buffer: ArrayBuffer, fallback: string): Promise<string> {
  if (!crypto?.subtle) return `weak-${fallback}`
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function isAudioFile(name: string): boolean {
  return /\.(mp3|m4a|aac|flac|wav|ogg|opus|webm)$/i.test(name)
}
