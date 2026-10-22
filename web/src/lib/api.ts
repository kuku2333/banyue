export interface ApiError extends Error {
  status: number
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  body?: unknown
}

/** 统一的接口调用：带 cookie，错误转成可读文案 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    // fetch 只在网络层失败时 reject（离线、DNS、被拦截），文案不要露出 "Failed to fetch"
    const error = new Error('网络不通，检查一下连接再试') as ApiError
    error.status = 0
    throw error
  }
  const text = await response.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data ? String((data as { error: string }).error) : `请求失败（${response.status}）`
    const error = new Error(message) as ApiError
    error.status = response.status
    throw error
  }
  if (text && data === null) {
    // 纯静态托管（GitHub Pages / nginx 只发 dist）会把 /api/* 回退成 index.html，
    // 这时候别把 "Cannot read properties of null" 抛给用户
    const error = new Error('这个部署没有后端接口，云端功能不可用') as ApiError
    error.status = response.status
    throw error
  }
  return data as T
}

export interface PublicUser {
  id: string
  username: string
  displayName: string
  isAdmin?: boolean
}
