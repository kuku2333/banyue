import { api } from './api'

export interface CloudAsset {
  id: string
  kind: 'book' | 'track'
  title: string
  subtitle: string
  size: number
  mime: string
  hash: string
  createdAt: number
  owner: { username: string; displayName: string }
  mine: boolean
}

export interface StorageUsage {
  used: number
  quota: number
}

export async function getStorage(): Promise<StorageUsage | null> {
  try {
    return await api<StorageUsage>('/api/storage')
  } catch {
    return null
  }
}

export function assetUrl(id: string): string {
  return `/api/assets/${encodeURIComponent(id)}/file`
}

export async function listAssets(kind: 'book' | 'track'): Promise<CloudAsset[]> {
  const data = await api<{ assets: CloudAsset[] }>(`/api/assets?kind=${kind}`)
  return data.assets
}

export interface UploadResult {
  id: string
  duplicate: boolean
}

export async function uploadAsset(
  kind: 'book' | 'track',
  blob: Blob,
  meta: { title: string; subtitle?: string; filename?: string; hash?: string },
): Promise<UploadResult> {
  const headers: Record<string, string> = {
    'content-type': blob.type || 'application/octet-stream',
    'x-title': encodeURIComponent(meta.title),
    'x-subtitle': encodeURIComponent(meta.subtitle ?? ''),
    'x-filename': encodeURIComponent(meta.filename ?? ''),
  }
  if (meta.hash) headers['x-hash'] = encodeURIComponent(meta.hash)

  const response = await fetch(`/api/assets?kind=${kind}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: blob,
  })
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { id?: string; duplicate?: boolean; error?: string }) : {}
  if (!response.ok) throw new Error(data.error ?? `上传失败（${response.status}）`)
  return { id: data.id ?? '', duplicate: Boolean(data.duplicate) }
}

export async function deleteAsset(id: string): Promise<void> {
  await api(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export interface SyncResult {
  uploaded: number
  skipped: number
  failed: number
}

/**
 * 一键同步本地音乐到云端：云端已有的（按内容指纹）不再上传。
 * tracks 需带 `hash`（本地导入时算好的 SHA-256 前 16 位）；无指纹的保守起见会上传。
 */
export async function syncTracksToCloud(
  tracks: { id: string; title: string; artist: string; hash?: string }[],
  getBlob: (id: string) => Promise<Blob | undefined>,
  onProgress?: (done: number, total: number) => void,
): Promise<SyncResult> {
  const cloud = await listAssets('track')
  const cloudHashes = new Set(cloud.map((asset) => asset.hash).filter(Boolean))
  const result: SyncResult = { uploaded: 0, skipped: 0, failed: 0 }

  let done = 0
  for (const track of tracks) {
    done++
    if (track.hash && cloudHashes.has(track.hash)) {
      result.skipped++
      onProgress?.(done, tracks.length)
      continue
    }
    const blob = await getBlob(track.id)
    if (!blob) {
      result.failed++
      onProgress?.(done, tracks.length)
      continue
    }
    try {
      await uploadAsset('track', blob, {
        title: track.title,
        subtitle: track.artist,
        filename: track.title,
        hash: track.hash,
      })
      result.uploaded++
    } catch {
      result.failed++
    }
    onProgress?.(done, tracks.length)
  }
  return result
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
