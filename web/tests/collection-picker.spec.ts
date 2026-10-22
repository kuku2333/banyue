import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { Pinia } from 'pinia'

const calls: { path: string; method: string; body?: unknown }[] = []

vi.mock('@/lib/api', () => ({
  api: async (path: string, options: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: options.method ?? 'GET', body: options.body })
    if (path === '/api/collections') return { id: 'c-new' }
    if (path === '/api/collections?type=music') return { collections: [] }
    return { ok: true }
  },
}))

const { default: CollectionPicker } = await import('@/components/CollectionPicker.vue')
const { useAuthStore } = await import('@/stores/auth')

function mountPicker(pinia: Pinia) {
  setActivePinia(pinia)
  const auth = useAuthStore(pinia)
  auth.user = { id: 'u1', username: 'alice', displayName: '爱丽丝' }
  auth.ready = true

  return mount(CollectionPicker, {
    props: {
      open: true,
      type: 'music',
      item: { key: 'apple-1', title: '午夜場', subtitle: 'Anson Lo' },
    },
    global: { plugins: [pinia] },
  })
}

describe('加入收藏夹', () => {
  beforeEach(() => {
    calls.length = 0
  })

  it('「创建并加入」既建收藏夹也把条目放进去', async () => {
    const wrapper = mountPicker(createPinia())

    await wrapper.find('.ghost').trigger('click')
    await wrapper.find('.new input').setValue('通勤循环')
    await wrapper.find('form.new').trigger('submit')
    await flushPromises()

    const created = calls.find((call) => call.path === '/api/collections' && call.method === 'POST')
    expect(created?.body).toMatchObject({ type: 'music', name: '通勤循环' })

    const added = calls.find((call) => call.path === '/api/collections/c-new/items')
    expect(added?.method).toBe('POST')
    expect(added?.body).toMatchObject({ key: 'apple-1', title: '午夜場' })
  })
})
