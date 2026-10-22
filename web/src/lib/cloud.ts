import { api } from './api'

export interface CloudAsset {
  id: string
  kind: 'book' | 'track'
  title: string
  subtitle: string
  size: number
  mime: string
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

export async function uploadAsset(
  kind: 'book' | 'track',
  blob: Blob,
  meta: { title: string; subtitle?: string; filename?: string },
): Promise<string> {
  const response = await fetch(`/api/assets?kind=${kind}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': blob.type || 'application/octet-stream',
      'x-title': encodeURIComponent(meta.title),
      'x-subtitle': encodeURIComponent(meta.subtitle ?? ''),
      'x-filename': encodeURIComponent(meta.filename ?? ''),
    },
    body: blob,
  })
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { id?: string; error?: string }) : {}
  if (!response.ok) throw new Error(data.error ?? `上传失败（${response.status}）`)
  return data.id ?? ''
}

export async function deleteAsset(id: string): Promise<void> {
  await api(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}
