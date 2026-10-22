import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/lib/api'

function respond(body: string, status = 200, type = 'application/json') {
  vi.stubGlobal('fetch', async () => new Response(body, { status, headers: { 'content-type': type } }))
}

describe('api 的错误文案', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('后端返回的 error 原样透出', async () => {
    respond(JSON.stringify({ error: '需要登录' }), 401)
    await expect(api('/api/me')).rejects.toThrow('需要登录')
  })

  it('纯静态部署把 /api 回退成 HTML 时提示没有后端', async () => {
    respond('<!doctype html><html><body>首页</body></html>', 200, 'text/html')
    await expect(api('/api/me')).rejects.toThrow('没有后端接口')
  })

  it('离线时不暴露 Failed to fetch', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })
    await expect(api('/api/me')).rejects.toThrow('网络不通')
  })

  it('空响应体按 null 处理', async () => {
    respond('', 200)
    await expect(api('/api/noop')).resolves.toBeNull()
  })
})
