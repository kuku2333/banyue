<script setup lang="ts">
import { ref, watch } from 'vue'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

interface MineCollection {
  id: string
  type: 'music' | 'books'
  name: string
  itemCount: number
  owner: { username: string; displayName: string }
  mine: boolean
}

const props = defineProps<{
  open: boolean
  type: 'music' | 'books'
  item: { key: string; title: string; subtitle: string } | null
}>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const auth = useAuthStore()
const list = ref<MineCollection[]>([])
const loading = ref(false)
const error = ref('')
const notice = ref('')
const creating = ref(false)
const newName = ref('')
const busy = ref(false)

async function load(): Promise<void> {
  if (!auth.loggedIn) {
    list.value = []
    return
  }
  loading.value = true
  try {
    const data = await api<{ collections: MineCollection[] }>(`/api/collections?type=${props.type}`)
    list.value = data.collections.filter((item) => item.mine)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.open, props.type],
  async ([open]) => {
    if (!open) return
    error.value = ''
    notice.value = ''
    creating.value = false
    await auth.ensure()
    await load()
  },
)

async function addTo(collectionId: string): Promise<void> {
  if (!props.item || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await api(`/api/collections/${collectionId}/items`, {
      method: 'POST',
      body: { key: props.item.key, title: props.item.title, subtitle: props.item.subtitle },
    })
    notice.value = '已加入'
    await load()
    setTimeout(() => emit('update:open', false), 700)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function createAndAdd(): Promise<void> {
  if (!newName.value.trim() || busy.value) return
  busy.value = true
  error.value = ''
  let id = ''
  try {
    const data = await api<{ id: string }>('/api/collections', {
      method: 'POST',
      body: { type: props.type, name: newName.value.trim(), description: '' },
    })
    id = data.id
    newName.value = ''
    creating.value = false
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    // 这里必须先放锁：addTo 自己会再取一次，否则「创建并加入」只建不加
    busy.value = false
  }
  if (id) await addTo(id)
}
</script>

<template>
  <Transition name="picker">
    <div v-if="open" class="picker-layer" role="dialog" aria-modal="true" aria-label="加入收藏夹" @click.self="emit('update:open', false)">
      <div class="picker">
        <header>
          <div>
            <h2>加入收藏夹</h2>
            <p class="muted small">{{ item?.title }}</p>
          </div>
          <button type="button" class="close" aria-label="关闭" @click="emit('update:open', false)">×</button>
        </header>

        <template v-if="!auth.loggedIn">
          <p class="muted small">收藏夹挂在账号上，登录后才能加入。</p>
          <button type="button" class="primary" @click="auth.openDialog()">登录 / 注册</button>
        </template>

        <template v-else>
          <p v-if="loading" class="muted small">加载中…</p>
          <ul v-else-if="list.length" class="mine-list">
            <li v-for="collection in list" :key="collection.id">
              <button type="button" class="pick" :disabled="busy" @click="addTo(collection.id)">
                <span>{{ collection.name }}</span>
                <small>{{ collection.itemCount }} 项</small>
              </button>
            </li>
          </ul>
          <p v-else class="muted small">你还没有{{ type === 'music' ? '音乐' : '书架' }}收藏夹，新建一个吧。</p>

          <form v-if="creating" class="new" @submit.prevent="createAndAdd">
            <input v-model="newName" maxlength="40" placeholder="新收藏夹名字" aria-label="新收藏夹名字" />
            <button type="submit" class="primary" :disabled="busy">创建并加入</button>
          </form>
          <button v-else type="button" class="ghost" @click="creating = true">+ 新建收藏夹</button>

          <p v-if="notice" class="notice">{{ notice }}</p>
          <p v-if="error" class="error">{{ error }}</p>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.picker-layer {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(5, 8, 11, 0.7);
  backdrop-filter: blur(6px);
}

.picker {
  width: min(100%, 380px);
  padding: 18px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--card);
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

h2 {
  margin: 0 0 2px;
  font-size: 1rem;
}

.close {
  color: var(--dim);
  font-size: 1.2rem;
  line-height: 1;
}

.mine-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 240px;
  overflow-y: auto;
}

.pick {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 9px;
  border: 1px solid var(--line);
  color: var(--text);
  font-size: 0.85rem;
  text-align: left;
}

.pick:hover {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}

.pick small {
  color: var(--dim);
  font-size: 0.72rem;
}

.new {
  display: flex;
  gap: 8px;
}

.new input {
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
  font-size: 0.82rem;
}

.ghost {
  align-self: flex-start;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px dashed var(--line-strong);
  color: var(--muted);
  font-size: 0.78rem;
}

.ghost:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}

.notice {
  margin: 0;
  color: var(--accent);
  font-size: 0.8rem;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 0.8rem;
}

.small {
  font-size: 0.78rem;
}

.picker-enter-active,
.picker-leave-active {
  transition: opacity 0.18s ease;
}

.picker-enter-from,
.picker-leave-to {
  opacity: 0;
}
</style>
