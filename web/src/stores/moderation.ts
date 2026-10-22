import { defineStore } from 'pinia'
import { ref } from 'vue'
import { api } from '@/lib/api'
import type { Post } from '@/lib/content'

/** 管理员隐藏的文章（只存在服务端，前端据此过滤） */
export const useModerationStore = defineStore('moderation', () => {
  const hidden = ref<string[]>([])
  const loaded = ref(false)

  async function load(): Promise<void> {
    if (loaded.value) return
    try {
      const data = await api<{ posts: { slug: string }[] }>('/api/hidden-posts')
      hidden.value = data.posts.map((item) => item.slug)
    } catch {
      hidden.value = []
    } finally {
      loaded.value = true
    }
  }

  function isHidden(slug: string): boolean {
    return hidden.value.includes(slug)
  }

  function visible(list: Post[]): Post[] {
    return list.filter((post) => !isHidden(post.slug))
  }

  async function hide(slug: string): Promise<void> {
    await api(`/api/posts/${encodeURIComponent(slug)}/hide`, { method: 'POST' })
    hidden.value = hidden.value.includes(slug) ? hidden.value : [...hidden.value, slug]
  }

  async function unhide(slug: string): Promise<void> {
    await api(`/api/posts/${encodeURIComponent(slug)}/hide`, { method: 'DELETE' })
    hidden.value = hidden.value.filter((item) => item !== slug)
  }

  return { hidden, loaded, load, isHidden, visible, hide, unhide }
})
