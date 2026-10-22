import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

const calls: string[] = []

vi.mock('@/lib/api', () => ({
  api: async (path: string, options: { method?: string } = {}) => {
    calls.push(`${options.method ?? 'GET'} ${path}`)
    if (path === '/api/auth/recovery-code') return { recoveryCode: 'ABCD-EFGH-JKLM-NPQR' }
    return {}
  },
}))

const { default: SiteHeader } = await import('@/components/SiteHeader.vue')
const { useAuthStore } = await import('@/stores/auth')

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: { template: '<div />' } },
      { path: '/collections', name: 'collections', component: { template: '<div />' } },
      { path: '/shelf', name: 'shelf', component: { template: '<div />' } },
      { path: '/archive', name: 'archive', component: { template: '<div />' } },
      { path: '/tags', name: 'tags', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: { template: '<div />' } },
      { path: '/write', name: 'write', component: { template: '<div />' } },
      { path: '/music', name: 'music', component: { template: '<div />' } },
    ],
  })
}

async function mountHeader(loggedIn: boolean) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const auth = useAuthStore(pinia)
  auth.ready = true
  auth.user = loggedIn ? { id: 'u1', username: 'alice', displayName: '爱丽丝' } : null

  const router = makeRouter()
  await router.push('/')
  await router.isReady()

  const wrapper = mount(SiteHeader, { global: { plugins: [pinia, router] } })
  return { wrapper, auth }
}

describe('顶部账号菜单', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('未登录时只显示登录按钮', async () => {
    const { wrapper } = await mountHeader(false)
    expect(wrapper.text()).toContain('登录')
    expect(wrapper.find('.account-menu').exists()).toBe(false)
  })

  it('登录后能展开菜单并退出登录', async () => {
    const { wrapper, auth } = await mountHeader(true)
    await wrapper.find('.user-chip').trigger('click')
    expect(wrapper.find('.account-menu').exists()).toBe(true)
    expect(wrapper.text()).toContain('退出登录')

    const signOut = wrapper.findAll('.account-menu button').find((btn) => btn.text() === '退出登录')
    await signOut!.trigger('click')
    await flushPromises()

    expect(calls).toContain('POST /api/auth/logout')
    expect(auth.user).toBeNull()
    expect(wrapper.find('.account-menu').exists()).toBe(false)
  })

  it('能重新生成恢复码，并弹出只显示一次的弹窗', async () => {
    const { wrapper, auth } = await mountHeader(true)
    // regenerateRecoveryCode 会读取返回里的 recoveryCode
    await wrapper.find('.user-chip').trigger('click')
    const button = wrapper.findAll('.account-menu button').find((btn) => btn.text().includes('恢复码'))
    await button!.trigger('click')
    await flushPromises()

    expect(calls).toContain('POST /api/auth/recovery-code')
    expect(auth.recoveryCode).toBe('ABCD-EFGH-JKLM-NPQR')
    expect(auth.dialogOpen).toBe(true)
    expect(wrapper.find('.account-menu').exists()).toBe(false)
  })
})
