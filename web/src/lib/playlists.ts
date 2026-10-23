import { api } from './api'

/** 歌单（云端）：公开的所有人可见，私有只有自己可见 */
export interface PlaylistSummary {
  id: string
  name: string
  description: string
  isPublic: boolean
  createdAt: number
  itemCount: number
  owner: { username: string; displayName: string }
  mine: boolean
}

export interface PlaylistItem {
  id: string
  key: string
  title: string
  artist: string
  assetId: string
  hash: string
  position: number
}

export interface PlaylistDetail extends PlaylistSummary {
  items: PlaylistItem[]
}

export interface PlaylistList {
  playlists: PlaylistSummary[]
  hidden: string[]
}

export async function listPlaylists(): Promise<PlaylistList> {
  return api<PlaylistList>('/api/playlists')
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  const data = await api<{ playlist: PlaylistDetail }>(`/api/playlists/${encodeURIComponent(id)}`)
  return data.playlist
}

export async function createPlaylist(input: {
  name: string
  description?: string
  isPublic?: boolean
}): Promise<string> {
  const data = await api<{ id: string }>('/api/playlists', { method: 'POST', body: input })
  return data.id
}

export async function updatePlaylist(
  id: string,
  patch: { name?: string; description?: string; isPublic?: boolean },
): Promise<void> {
  await api(`/api/playlists/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
}

export async function deletePlaylist(id: string): Promise<void> {
  await api(`/api/playlists/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export async function addPlaylistItem(
  id: string,
  item: { title: string; artist?: string; key?: string; assetId?: string; hash?: string },
): Promise<void> {
  await api(`/api/playlists/${encodeURIComponent(id)}/items`, { method: 'POST', body: item })
}

export async function removePlaylistItem(playlistId: string, itemId: string): Promise<void> {
  await api(
    `/api/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE' },
  )
}

export async function hidePlaylist(id: string): Promise<void> {
  await api(`/api/playlists/${encodeURIComponent(id)}/hide`, { method: 'POST' })
}

export async function unhidePlaylist(id: string): Promise<void> {
  await api(`/api/playlists/${encodeURIComponent(id)}/hide`, { method: 'DELETE' })
}

export async function listHiddenPlaylists(): Promise<{ id: string; name: string; owner: { username: string; displayName: string } }[]> {
  const data = await api<{ playlists: { id: string; name: string; owner: { username: string; displayName: string } }[] }>(
    '/api/playlists-hidden',
  )
  return data.playlists
}
