<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'

interface CollectionSummary {
  id: string
  type: 'music' | 'books'
  name: string
  description: string
  createdAt: number
  itemCount: number
  owner: { username: string; displayName: string }
  mine: boolean
}

interface CollectionItem {
  id: string
  key: string
  title: string
  subtitle: string
}

interface CollectionDetail extends Omit<CollectionSummary, 'itemCount'> {
  items: CollectionItem[]
}

const auth = useAuthStore()
const type = ref<'music' | 'books'>('music')
const list = ref<CollectionSummary[]>([])
const loading = ref(false)
const error = ref('')
const detail = ref<CollectionDetail | null>(null)

const creating = ref(false)
const newName = ref('')
const newDesc = ref('')
const createError = ref('')

const heading = computed(() => (type.value === 'music' ? '音乐收藏夹' : '书架收藏夹'))
const emptyHint = computed(() =>
  type.value === 'music' ? '还没有人建音乐收藏夹，做第一个。' : '还没有书架收藏夹。',
)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ collections: CollectionSummary[] }>(`/api/collections?type=${type.value}`)
    list.value = data.collections
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function open(id: string): Promise<void> {
  try {
    const data = await api<{ collection: CollectionDetail }>(`/api/collections/${id}`)
    detail.value = data.collection
  } catch (err) {
    error.value = (err as Error).message
  }
}

async function create(): Promise<void> {
  if (!auth.loggedIn) {
    auth.openDialog()
    return
  }
  createError.value = ''
  if (!newName.value.trim()) {
    createError.value = '起个名字吧'
    return
  }
  try {
    const data = await api<{ id: string }>('/api/collections', {
      method: 'POST',
      body: { type: type.value, name: newName.value.trim(), description: newDesc.value.trim() },
    })
    creating.value = false
    newName.value = ''
    newDesc.value = ''
    await load()
    await open(data.id)
  } catch (err) {
    createError.value = (err as Error).message
  }
}

async function removeCollection(): Promise<void> {
  if (!detail.value?.mine) return
  if (!window.confirm(`删除收藏夹「${detail.value.name}」？`)) return
  await api(`/api/collections/${detail.value.id}`, { method: 'DELETE' })
  detail.value = null
  await load()
}

async function removeItem(item: CollectionItem): Promise<void> {
  if (!detail.value?.mine) return
  await api(`/api/collections/${detail.value.id}/items/${item.id}`, { method: 'DELETE' })
  await open(detail.value.id)
  await load()
}

watch(type, () => {
  detail.value = null
  void load()
})

onMounted(async () => {
  await auth.ensure()
  await load()
})
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Collections</span>
      <h1>收藏夹</h1>
      <p>所有收藏夹都是公开的：谁建的、里面有什么，大家都能看到。加内容需要登录。</p>
    </div>

    <div class="toolbar">
      <div class="chips">
        <button type="button" class="chip" :class="{ on: type === 'music' }" @click="type = 'music'">音乐</button>
        <button type="button" class="chip" :class="{ on: type === 'books' }" @click="type = 'books'">书架</button>
      </div>
      <button type="button" class="btn" @click="auth.loggedIn ? (creating = !creating) : auth.openDialog()">
        {{ auth.loggedIn ? (creating ? '取消' : '新建收藏夹') : '登录后新建' }}
      </button>
    </div>

    <form v-if="creating" class="create-box" @submit.prevent="create">
      <input v-model="newName" maxlength="40" placeholder="收藏夹名字，例如「通勤循环」" aria-label="收藏夹名字" />
      <input v-model="newDesc" maxlength="200" placeholder="一句话简介（可选）" aria-label="收藏夹简介" />
      <button type="submit" class="btn btn--solid">创建</button>
      <p v-if="createError" class="error">{{ createError }}</p>
    </form>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="loading" class="empty">正在加载…</p>

    <div v-else-if="!list.length" class="empty">{{ emptyHint }}</div>

    <div v-else class="collection-grid">
      <button v-for="item in list" :key="item.id" type="button" class="collection-card" @click="open(item.id)">
        <div class="card-top">
          <b>{{ item.name }}</b>
          <span class="count">{{ item.itemCount }} 项</span>
        </div>
        <p v-if="item.description">{{ item.description }}</p>
        <div class="owner">
          <span class="avatar">{{ item.owner.displayName.slice(0, 1) }}</span>
          <span>{{ item.owner.displayName }}<small>@{{ item.owner.username }}</small></span>
          <span v-if="item.mine" class="mine">我的</span>
        </div>
      </button>
    </div>

    <Transition name="panel">
      <section v-if="detail" class="detail">
        <header>
          <div>
            <h2>{{ detail.name }}</h2>
            <p class="muted small">
              {{ heading }} · {{ detail.owner.displayName }}<span>@{{ detail.owner.username }}</span> 创建
            </p>
          </div>
          <div class="detail-actions">
            <button v-if="detail.mine" type="button" class="btn tiny danger" @click="removeCollection">删除收藏夹</button>
            <button type="button" class="btn tiny" @click="detail = null">关闭</button>
          </div>
        </header>

        <p v-if="detail.description" class="muted small">{{ detail.description }}</p>

        <ol v-if="detail.items.length" class="item-list">
          <li v-for="item in detail.items" :key="item.id">
            <div class="item-main">
              <b>{{ item.title }}</b>
              <span v-if="item.subtitle">{{ item.subtitle }}</span>
            </div>
            <button v-if="detail.mine" type="button" class="remove" @click="removeItem(item)">移除</button>
          </li>
        </ol>
        <p v-else class="empty small">这个收藏夹还是空的。</p>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0 18px;
}

.create-box {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr) auto;
  gap: 10px;
  align-items: center;
  margin-bottom: 18px;
  padding: 14px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--card);
}

.create-box input {
  min-height: 42px;
  padding: 9px 12px;
  border-radius: 9px;
  border: 1px solid var(--line-strong);
  background: var(--bg-soft);
  color: var(--text);
  outline: none;
}

.create-box .error {
  grid-column: 1 / -1;
}

.collection-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 14px;
}

.collection-card {
  text-align: left;
  padding: 16px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--card);
  transition: 0.18s ease;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.collection-card:hover {
  border-color: var(--accent-line);
  transform: translateY(-2px);
}

.card-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.card-top b {
  font-family: var(--serif);
  font-size: 1.02rem;
}

.count {
  color: var(--dim);
  font-size: 0.72rem;
}

.collection-card p {
  margin: 0;
  color: var(--muted);
  font-size: 0.82rem;
  line-height: 1.6;
}

.owner {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: auto;
  color: var(--text-2);
  font-size: 0.78rem;
}

.owner small {
  margin-left: 4px;
  color: var(--dim);
}

.avatar {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  color: var(--accent);
  font-size: 0.72rem;
}

.mine {
  margin-left: auto;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--accent-line);
  color: var(--accent);
  font-size: 0.68rem;
}

.detail {
  margin-top: 26px;
  padding: 18px;
  border-radius: var(--radius);
  border: 1px solid var(--line-strong);
  background: var(--card);
}

.detail header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.detail h2 {
  margin: 0 0 4px;
  font-family: var(--serif);
  font-size: 1.2rem;
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.btn.tiny {
  padding: 5px 10px;
  font-size: 0.75rem;
  border-radius: 8px;
}

.btn.tiny.danger:hover {
  color: var(--danger);
  border-color: rgba(251, 113, 133, 0.4);
}

.item-list {
  list-style: none;
  margin: 14px 0 0;
  padding: 0;
  border-top: 1px solid var(--line);
}

.item-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--line);
}

.item-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.item-main b {
  font-size: 0.9rem;
  font-weight: 500;
}

.item-main span {
  color: var(--muted);
  font-size: 0.76rem;
}

.remove {
  color: var(--dim);
  font-size: 0.75rem;
}

.remove:hover {
  color: var(--danger);
}

.error {
  color: var(--danger);
  font-size: 0.8rem;
}

.small {
  font-size: 0.78rem;
}

.panel-enter-active,
.panel-leave-active {
  transition: opacity 0.2s ease;
}

.panel-enter-from,
.panel-leave-to {
  opacity: 0;
}
</style>
