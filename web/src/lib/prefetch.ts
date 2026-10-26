import type { RouteRecordName } from 'vue-router'
import { router } from '@/router'

/**
 * 路由级预加载：把动态 import() 的组件提前拉到浏览器的模块缓存里，
 * 等用户真正点进去时几乎是瞬时切换。对首屏没有任何成本。
 */

// 缓存已经预取过的路由名，避免重复触发
const prefetched = new Set<RouteRecordName | string | undefined>()

export function prefetchRoute(name: RouteRecordName | string): void {
  if (prefetched.has(name)) return
  const matched = router.getRoutes().find((route) => route.name === name)
  const loader = matched?.components?.default
  if (typeof loader === 'function') {
    void (loader as () => Promise<unknown>)()
    prefetched.add(name)
  }
}

/** 浏览器空闲时批量预取一组路由，不抢首屏资源 */
export function prefetchOnIdle(names: (RouteRecordName | string)[]): void {
  const run = () => names.forEach((name) => prefetchRoute(name))
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback
  if (typeof ric === 'function') ric(run)
  else setTimeout(run, 1200)
}

/** 给一个链接元素绑定 hover/触屏预取，进页面前先把组件拉好 */
export function bindPrefetch(el: HTMLElement, name: RouteRecordName | string): void {
  const fire = () => prefetchRoute(name)
  el.addEventListener('mouseenter', fire, { once: true })
  el.addEventListener('touchstart', fire, { once: true })
  el.addEventListener('focus', fire, { once: true })
}
