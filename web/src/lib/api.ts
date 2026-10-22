export interface ApiError extends Error {
  status: number
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'DELETE' | 'PATCH'
  body?: unknown
}

/** 统一的接口调用：带 cookie，错误转成可读文案 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
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
  return data as T
}

export interface PublicUser {
  id: string
  username: string
  displayName: string
  isAdmin?: boolean
}
