<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { posts } from '@/lib/content'
import { formatDate } from '@/lib/format'
import { useModerationStore } from '@/stores/moderation'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const router = useRouter()
const moderation = useModerationStore()
const keyword = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

const results = computed(() => {
  // 被管理员隐藏的文章不该从搜索里漏出来
  const source = moderation.visible(posts)
  const q = keyword.value.trim().toLowerCase()
  if (!q) return source.slice(0, 5)
  return source
    .filter((post) => {
      const haystack = `${post.title} ${post.excerpt} ${post.tags.join(' ')} ${post.html}`
      return haystack.toLowerCase().includes(q)
    })
    .slice(0, 8)
})

watch(
  () => props.open,
  async (open) => {
    if (open) {
      keyword.value = ''
      activeIndex.value = 0
      await nextTick()
      inputRef.value?.focus()
    }
  },
)

watch(results, () => {
  activeIndex.value = 0
})

function close(): void {
  emit('update:open', false)
}

function go(slug: string): void {
  close()
  void router.push(`/post/${slug}`)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % Math.max(results.value.length, 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value =
      (activeIndex.value - 1 + results.value.length) % Math.max(results.value.length, 1)
  } else if (event.key === 'Enter') {
    const target = results.value[activeIndex.value]
    if (target) go(target.slug)
  }
}
</script>

<template>
  <Transition name="search">
    <div v-if="open" class="search-layer" role="dialog" aria-modal="true" aria-label="搜索文章" @click.self="close">
      <div class="search-box">
        <div class="search-field">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            ref="inputRef"
            v-model="keyword"
            type="search"
            placeholder="搜索标题、摘要、正文或标签…"
            autocomplete="off"
            aria-label="搜索关键词"
            @keydown="onKeydown"
          />
        </div>
        <div class="search-hint">↑ ↓ 选择 · Enter 打开 · Esc 关闭</div>
        <div class="search-results">
          <button
            v-for="(post, index) in results"
            :key="post.slug"
            type="button"
            class="search-item"
            :class="{ on: index === activeIndex }"
            @click="go(post.slug)"
            @mouseenter="activeIndex = index"
          >
            <b>{{ post.title }}</b>
            <span>{{ formatDate(post.date) }} · {{ post.tags.join(' / ') }}</span>
          </button>
          <p v-if="!results.length" class="empty">没有找到匹配的文章</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.search-enter-active,
.search-leave-active {
  transition: opacity 0.16s ease;
}

.search-enter-from,
.search-leave-to {
  opacity: 0;
}
</style>
