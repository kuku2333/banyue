<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { isCloudTrack, trackKeyFor } from '@/lib/keys'
import { useAuthStore } from '@/stores/auth'
import type { Track } from '@/lib/music'

interface CloudComment {
  id: string
  body: string
  createdAt: number
  owner: { username: string; displayName: string }
  mine: boolean
}

const props = defineProps<{ open: boolean; track: Track | null }>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const auth = useAuthStore()
const draft = ref('')
const cloud = ref<CloudComment[]>([])
const local = ref<{ id: string; body: string; createdAt: number }[]>([])
const loading = ref(false)
const error = ref('')
const message = ref('')

const isCloud = computed(() => (props.track ? isCloudTrack(props.track) : false))
const rows = computed(() => {
  if (isCloud.value) {
    return cloud.value.map((item) => ({
      id: item.id,
      body: item.body,
      owner: item.owner.displayName,
      mine: item.mine,
      local: false,
      createdAt: item.createdAt,
    }))
  }
  return local.value.map((item) => ({
    id: item.id,
    body: item.body,
    owner: '本机',
    mine: true,
    local: true,
    createdAt: item.createdAt,
  }))
})

async function load(): Promise<void> {
  if (!props.track) return
  loading.value = true
  error.value = ''
  try {
    if (isCloud.value) {
      const data = await api<{ comments: CloudComment[] }>(`/api/songs/${encodeURIComponent(trackKeyFor(props.track))}/comments`)
      cloud.value = data.comments
    } else {
      const { listSongNotes } = await import('@/lib/db')
      local.value = await listSongNotes(props.track.id)
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

watch(
  // 面板开着的时候再切歌也要跟着刷新，否则会看到上一首的评论
  () => [props.open, props.track?.id] as const,
  async ([open]) => {
    if (!open) return
    draft.value = ''
    message.value = ''
    error.value = ''
    local.value = []
    cloud.value = []
    await auth.ensure()
    await load()
  },
)

async function submit(): Promise<void> {
  const text = draft.value.trim()
  if (!text || !props.track) return
  error.value = ''
  message.value = ''
  if (isCloud.value) {
    if (!auth.loggedIn) {
      auth.openDialog()
      return
    }
    try {
      await api(`/api/songs/${encodeURIComponent(trackKeyFor(props.track))}/comments`, {
        method: 'POST',
        body: { body: text },
      })
      message.value = '已发布'
    } catch (err) {
      error.value = (err as Error).message
      return
    }
  } else {
    const { addSongNote } = await import('@/lib/db')
    await addSongNote({
      id: `sn-${Date.now().toString(36)}`,
      trackId: props.track.id,
      body: text,
      createdAt: Date.now(),
    })
    message.value = '只存在这台电脑上'
  }
  draft.value = ''
  await load()
}

async function remove(id: string, isLocal: boolean): Promise<void> {
  if (isLocal) {
    const { deleteSongNote } = await import('@/lib/db')
    await deleteSongNote(id)
  } else if (props.track) {
    await api(`/api/songs/${encodeURIComponent(trackKeyFor(props.track))}/comments/${id}`, {
      method: 'DELETE',
    }).catch(() => {})
  }
  await load()
}
</script>

<template>
  <Transition name="comments">
    <div v-if="open" class="layer" @click.self="emit('update:open', false)">
      <section class="box" role="dialog" aria-modal="true" aria-label="歌曲评论">
        <header>
          <div>
            <h3>评论</h3>
            <p class="muted small">{{ track?.title }} · {{ track?.artist || '未知歌手' }}</p>
          </div>
          <button type="button" class="close" aria-label="关闭" @click="emit('update:open', false)">×</button>
        </header>

        <p class="hint small">
          {{ isCloud ? '云端歌曲的评论所有人可见。' : '这是本地文件，评论只存在这台电脑上，别人看不到。' }}
        </p>

        <div class="list">
          <p v-if="loading" class="muted small">加载中…</p>
          <p v-else-if="!rows.length" class="muted small">还没有评论。</p>
          <article v-for="row in rows" :key="row.id" class="comment">
            <div class="who">
              <b>{{ row.owner }}</b>
              <span v-if="row.local" class="tag">仅本机</span>
              <button
                v-if="row.mine || auth.user?.isAdmin"
                type="button"
                class="del"
                @click="remove(row.id, row.local)"
              >
                删除
              </button>
            </div>
            <p>{{ row.body }}</p>
          </article>
        </div>

        <form class="write" @submit.prevent="submit">
          <input v-model="draft" maxlength="500" :placeholder="isCloud && !auth.loggedIn ? '登录后才能评论' : '说点什么…'" aria-label="评论内容" />
          <button type="submit" class="primary">{{ isCloud && !auth.loggedIn ? '登录' : '发布' }}</button>
        </form>
        <p v-if="message" class="notice">{{ message }}</p>
        <p v-if="error" class="error">{{ error }}</p>
      </section>
    </div>
  </Transition>
</template>

<style scoped>
.layer {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 8, 11, 0.72);
  backdrop-filter: blur(6px);
}

.box {
  width: min(100%, 420px);
  max-height: min(78vh, 620px);
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--card);
  box-shadow: var(--shadow);
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

h3 {
  margin: 0 0 2px;
  font-size: 1rem;
}

.close {
  color: var(--dim);
  font-size: 1.2rem;
  line-height: 1;
}

.small {
  font-size: 0.75rem;
  margin: 0;
}

.hint {
  color: var(--muted);
}

.list {
  flex: 1;
  min-height: 80px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}

.comment {
  padding: 9px 11px;
  border-radius: 9px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.03);
}

.who {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 0.74rem;
}

.tag {
  padding: 1px 7px;
  border-radius: 999px;
  border: 1px solid var(--line);
  color: var(--muted);
}

.del {
  margin-left: auto;
  color: var(--dim);
  font-size: 0.72rem;
}

.del:hover {
  color: var(--danger);
}

.comment p {
  margin: 4px 0 0;
  font-size: 0.85rem;
  line-height: 1.6;
  white-space: pre-wrap;
}

.write {
  display: flex;
  gap: 8px;
}

.write input {
  flex: 1;
  min-height: 40px;
  padding: 8px 12px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--bg-soft);
  color: var(--text);
  outline: none;
}

.primary {
  min-height: 40px;
  padding: 0 14px;
  border-radius: 9px;
  background: linear-gradient(120deg, var(--accent), var(--accent-2));
  color: #06211d;
  font-weight: 600;
  font-size: 0.8rem;
}

.notice {
  margin: 0;
  color: var(--accent);
  font-size: 0.76rem;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.76rem;
}

.comments-enter-active,
.comments-leave-active {
  transition: opacity 0.18s ease;
}

.comments-enter-from,
.comments-leave-to {
  opacity: 0;
}
</style>
