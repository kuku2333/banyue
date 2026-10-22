import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeView from '@/views/HomeView.vue'
import PostView from '@/views/PostView.vue'
import TagView from '@/views/TagView.vue'
import { posts } from '@/lib/content'
import { useModerationStore } from '@/stores/moderation'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/post/:slug', name: 'post', component: PostView },
      { path: '/tag/:tag', name: 'tag', component: TagView },
      { path: '/archive', name: 'archive', component: { template: '<div />' } },
      { path: '/tags', name: 'tags', component: { template: '<div />' } },
      { path: '/about', name: 'about', component: { template: '<div />' } },
    ],
  })
}

describe('首页', () => {
  it('渲染全部文章与统计', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(HomeView, {
      global: { plugins: [router, createPinia()] },
    })

    expect(wrapper.findAll('.post-card')).toHaveLength(posts.length)
    expect(wrapper.text()).toContain('篇文章')
    expect(wrapper.find('.hero h1').exists()).toBe(true)
  })

  it('点标签后只保留该标签的文章', async () => {
    const router = makeRouter()
    await router.push('/')
    await router.isReady()

    const wrapper = mount(HomeView, {
      global: { plugins: [router, createPinia()] },
    })

    const chips = wrapper.findAll('.chip')
    expect(chips.length).toBeGreaterThan(1)
    await chips[1]!.trigger('click')

    const expected = posts.filter((post) => post.tags.includes(chips[1]!.text().replace(/\d+$/, '').trim()))
    expect(expected.length).toBeGreaterThan(0)
    expect(wrapper.findAll('.post-card').length).toBe(expected.length)
  })
})

describe('文章页', () => {
  it('渲染标题、正文与目录', async () => {
    const router = makeRouter()
    const target = posts[0]!
    await router.push(`/post/${target.slug}`)
    await router.isReady()

    const wrapper = mount(PostView, {
      global: { plugins: [router, createPinia()] },
    })

    expect(wrapper.find('h1').text()).toBe(target.title)
    expect(wrapper.find('.prose').html()).toContain('<h2')
    expect(wrapper.findAll('.toc a').length).toBeGreaterThan(0)
  })

  it('未知 slug 给出友好提示', async () => {
    const router = makeRouter()
    await router.push('/post/not-exists')
    await router.isReady()

    const wrapper = mount(PostView, {
      global: { plugins: [router, createPinia()] },
    })

    expect(wrapper.text()).toContain('这篇文章不在了')
  })
})

describe('被管理员隐藏的文章', () => {
  const hidden = posts.find((post) => post.tags.length > 0)!

  async function mountTagPage() {
    const router = makeRouter()
    const tag = hidden.tags[0]!
    await router.push(`/tag/${encodeURIComponent(tag)}`)
    await router.isReady()

    const pinia = createPinia()
    setActivePinia(pinia)
    const moderation = useModerationStore()
    moderation.hidden = [hidden.slug]

    const wrapper = mount(TagView, { global: { plugins: [router, pinia] } })
    return { wrapper, tag, moderation }
  }

  it('标签页不再列出它', async () => {
    const { wrapper, tag } = await mountTagPage()
    const expected = posts.filter((post) => post.tags.includes(tag) && post.slug !== hidden.slug)
    expect(wrapper.findAll('.post-card')).toHaveLength(expected.length)
    expect(wrapper.text()).not.toContain(hidden.title)
  })

  it('「其他标签」的计数也不把它算进去', async () => {
    const { wrapper } = await mountTagPage()
    expect(wrapper.find('.page-head p').text()).toBe(
      `${posts.filter((post) => post.tags.includes(hidden.tags[0]!) && post.slug !== hidden.slug).length} 篇文章`,
    )
  })
})
