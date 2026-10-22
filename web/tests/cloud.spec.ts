import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// cloud.ts 里 listAssets 走 api()，uploadAsset 走裸 fetch()。
// 分别 mock 这两个底层，就能干净地测 sync 的编排逻辑。
vi.mock('@/lib/api', () => ({
  api: vi.fn(),
}))

import { api } from '@/lib/api'
import { syncTracksToCloud } from '@/lib/cloud'

const mockedApi = vi.mocked(api)

function mockUpload(status = 201, body: Record<string, unknown> = { id: 'a1', duplicate: false }) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })),
  )
}

describe('syncTracksToCloud', () => {
  beforeEach(() => {
    mockedApi.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const tracks = [
    { id: 't1', title: '已有', artist: 'A', hash: 'hash-1' },
    { id: 't2', title: '新歌', artist: 'B', hash: 'hash-2' },
    { id: 't3', title: '无指纹', artist: 'C' },
  ]

  it('云端已有的（按指纹）跳过，只传缺的', async () => {
    mockedApi.mockResolvedValue({
      assets: [
        { id: 'a1', kind: 'track', title: '已有', subtitle: 'A', size: 1, mime: 'audio/mpeg', hash: 'hash-1', createdAt: 1, owner: { username: 'x', displayName: 'X' }, mine: true },
      ],
    })
    mockUpload()

    const getBlob = vi.fn(async (id: string) => new Blob([id], { type: 'audio/mpeg' }))
    const result = await syncTracksToCloud(tracks, getBlob)

    expect(result).toEqual({ uploaded: 2, skipped: 1, failed: 0 })
    expect(getBlob).toHaveBeenCalledTimes(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('本地文件读不到算失败，不抛异常', async () => {
    mockedApi.mockResolvedValue({ assets: [] })
    mockUpload()
    const getBlob = vi.fn(async () => undefined)

    const result = await syncTracksToCloud(tracks, getBlob)
    expect(result.failed).toBe(3)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('上传抛错计入 failed，其余继续', async () => {
    mockedApi.mockResolvedValue({ assets: [] })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ok1', duplicate: false }), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: '空间不够' }), { status: 413, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'ok3', duplicate: false }), { status: 201, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const getBlob = vi.fn(async (id: string) => new Blob([id], { type: 'audio/mpeg' }))
    const result = await syncTracksToCloud(tracks, getBlob)

    expect(result.uploaded).toBe(2)
    expect(result.failed).toBe(1)
  })
})
