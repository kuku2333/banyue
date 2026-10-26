<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { posts } from '@/lib/content'
import { formatDate } from '@/lib/format'
import { KIND_LABEL, libraryEntries, runSearch, staticEntries, type SearchEntry, type SearchItem } from '@/lib/search'
import { useModerationStore } from '@/stores/moderation'
import { usePlayerStore } from '@/stores/player'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const router = useRouter()
const moderation = useModerationStore()
const player = usePlayerStore()

const keyword = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

/** 全站索引：静态部分立即就绪，书架/音乐异步补进来 */
const entries = ref<SearchEntry[]>([])
const loadingLibrary = ref(false)

const results = computed<SearchItem[]>(() => runSearch(keyword.value, entries.value))
const resultsEl = ref<HTMLElement | null>(null)

/** 空关键词时给几篇最近的，别让框里空着 */
const fallback = computed(() =>
  moderation
    .visible(posts)
    .slice(0, 5)
    .map((post) => ({
      key: `post:${post.slug}`,
      kind: 'post' as const,
      title: post.title,
      subtitle: `${formatDate(post.date)} · ${post.tags.join(' / ')}`,
      haystack: '',
      route: `/post/${post.slug}`,
      score: 0,
    })),
)

const shown = computed<SearchItem[]>(() => (keyword.value.trim() ? results.value : fallback.value))

async function loadIndex(): Promise<void> {
  entries.value = staticEntries(moderation.visible(posts))
  loadingLibrary.value = true
  try {
    const library = await libraryEntries()
    entries.value = [...entries.value, ...library]
  } finally {
    loadingLibrary.value = false
  }
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      keyword.value = ''
      activeIndex.value = 0
      await nextTick()
      inputRef.value?.focus()
      // 每次打开都重建，书架/音乐可能刚变过
      void loadIndex()
    }
  },
)

watch(shown, () => {
  activeIndex.value = 0
})

function close(): void {
  emit('update:open', false)
}

function activate(item: SearchItem): void {
  close()
  if (item.track) {
    void player.playOne(item.track)
    return
  }
  if (item.route) void router.push(item.route)
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % Math.max(shown.value.length, 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + shown.value.length) % Math.max(shown.value.length, 1)
  } else if (event.key === 'Enter') {
    const target = shown.value[activeIndex.value]
    if (target) activate(target)
  }
}

// 键盘上下移动时，确保高亮项始终在视野内（列表可滚动时）
watch(activeIndex, async (idx) => {
  await nextTick()
  const items = resultsEl.value?.querySelectorAll<HTMLElement>('.search-item')
  items?.[idx]?.scrollIntoView({ block: 'nearest' })
})

// 结果集变短时把高亮收回到有效区间，避免空激活
watch(
  () => shown.value.length,
  (len) => {
    if (activeIndex.value >= len) activeIndex.value = Math.max(0, len - 1)
  },
)
</script>

<template>
  <Transition name="search">
    <div
      v-if="open"
      class="search-layer"
      role="dialog"
      aria-modal="true"
      aria-label="全站搜索"
      @click.self="close"
    >
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
            placeholder="搜索文章、书、音乐、标签…"
            autocomplete="off"
            aria-label="搜索关键词"
            @keydown="onKeydown"
          />
        </div>
        <div class="search-hint">
          ↑ ↓ 选择 · Enter 打开 · Esc 关闭<template v-if="loadingLibrary"> · 正在加载书架与音乐…</template>
        </div>
        <div ref="resultsEl" class="search-results">
          <button
            v-for="(item, index) in shown"
            :key="item.key"
            type="button"
            class="search-item"
            :class="{ on: index === activeIndex }"
            @click="activate(item)"
            @mouseenter="activeIndex = index"
          >
            <span class="kind" :data-kind="item.kind">{{ KIND_LABEL[item.kind] }}</span>
            <span class="body">
              <b>{{ item.title }}</b>
              <span>{{ item.subtitle }}</span>
            </span>
          </button>
          <p v-if="!shown.length && keyword.trim()" class="empty">没有找到匹配的内容</p>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.search-results {
  max-height: min(60vh, 420px);
  overflow-y: auto;
  margin: 4px -10px 0;
  padding: 0 10px;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.kind {
  flex: none;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.66rem;
  letter-spacing: 0.04em;
}

.kind[data-kind='post'] {
  color: var(--accent);
  border-color: var(--accent-line);
}

.kind[data-kind='book'] {
  color: var(--accent-2);
  border-color: var(--accent-line);
}

.kind[data-kind='track'] {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.4);
}

.kind[data-kind='tag'] {
  color: var(--dim);
}

.body {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  min-width: 0;
  line-height: 1.35;
}

/* 标题不能被外层 span 的 muted 色带灰 */
.body b {
  color: var(--text);
}

.search-enter-active,
.search-leave-active {
  transition: opacity 0.16s ease;
}

.search-enter-from,
.search-leave-to {
  opacity: 0;
}
</style>
