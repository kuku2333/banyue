<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { usePlayerStore } from '@/stores/player'
import { assetUrl } from '@/lib/cloud'
import { findTrackByHash } from '@/lib/db'
import type { Track } from '@/lib/music'
import { listTracks } from '@/lib/db'
import { listAssets } from '@/lib/cloud'
import {
  addPlaylistItem,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  hidePlaylist,
  listHiddenPlaylists,
  listPlaylists,
  removePlaylistItem,
  unhidePlaylist,
  updatePlaylist,
  type PlaylistDetail,
  type PlaylistSummary,
} from '@/lib/playlists'

/** 歌单：自己的可编辑/公开，别人的公开歌单可隐藏 */
const auth = useAuthStore()
const player = usePlayerStore()

const playlists = ref<PlaylistSummary[]>([])
const hiddenOnes = ref<{ id: string; name: string; owner: { username: string; displayName: string } }[]>([])
const detail = ref<PlaylistDetail | null>(null)
const loading = ref(false)
const error = ref('')
const message = ref('')
const busy = ref(false)

const creating = ref(false)
const newName = ref('')
const newDescription = ref('')
const newPublic = ref(false)

const addTitle = ref('')
const addArtist = ref('')

/** 可加入歌单的歌曲：本地音乐 + 云端音乐 */
interface PickableTrack {
  key: string
  title: string
  artist: string
  hash: string
  assetId: string
  where: '本地' | '云端'
}
/* 歌单唱片分页：每行 5 个 × 4 行 = 20 个/页 */
const PAGE_SIZE = 20
const page = ref(0)

const pageCount = computed(() => Math.max(1, Math.ceil((detail.value?.items.length ?? 0) / PAGE_SIZE)))
const pageItems = computed(() => {
  const items = detail.value?.items ?? []
  const start = page.value * PAGE_SIZE
  return items.slice(start, start + PAGE_SIZE)
})

function gotoPage(next: number): void {
  page.value = Math.min(Math.max(0, next), pageCount.value - 1)
}

/* 打开歌单时回到第一页 */
watch(detail, () => {
  page.value = 0
})

const pickables = ref<PickableTrack[]>([])
const pickLoading = ref(false)
const showPickable = ref(false)

async function loadPickables(): Promise<void> {
  pickLoading.value = true
  try {
    const [locals, clouds] = await Promise.all([
      listTracks().catch(() => []),
      listAssets('track').catch(() => []),
    ])
    const seen = new Set<string>()
    const rows: PickableTrack[] = []
    for (const item of locals) {
      const key = item.hash || item.id
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ key, title: item.title, artist: item.artist, hash: item.hash, assetId: '', where: '本地' })
    }
    for (const item of clouds) {
      const key = item.hash || item.id
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({
        key,
        title: item.title,
        artist: item.subtitle,
        hash: item.hash,
        assetId: item.id,
        where: '云端',
      })
    }
    pickables.value = rows
  } finally {
    pickLoading.value = false
  }
}

async function addPickable(item: PickableTrack): Promise<void> {
  const current = detail.value
  if (!current || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await addPlaylistItem(current.id, {
      title: item.title,
      artist: item.artist,
      key: item.key,
      hash: item.hash,
      assetId: item.assetId,
    })
    await openPlaylist(current.id)
    await load()
    flash(`《${item.title}》已加入《${current.name}》`)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

const mine = computed(() => playlists.value.filter((item) => item.mine))
const others = computed(() => playlists.value.filter((item) => !item.mine))

function flash(text: string): void {
  message.value = text
  setTimeout(() => (message.value = ''), 4000)
}

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const data = await listPlaylists()
    playlists.value = data.playlists
    hiddenOnes.value = auth.loggedIn ? await listHiddenPlaylists() : []
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function openPlaylist(id: string): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    detail.value = await getPlaylist(id)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function submitCreate(): Promise<void> {
  if (!auth.loggedIn) {
    auth.openDialog()
    return
  }
  const name = newName.value.trim()
  if (!name) return
  busy.value = true
  error.value = ''
  try {
    const id = await createPlaylist({ name, description: newDescription.value.trim(), isPublic: newPublic.value })
    creating.value = false
    newName.value = ''
    newDescription.value = ''
    newPublic.value = false
    await load()
    await openPlaylist(id)
    flash('歌单已创建')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function togglePublic(): Promise<void> {
  const current = detail.value
  if (!current) return
  busy.value = true
  try {
    await updatePlaylist(current.id, { isPublic: !current.isPublic })
    await openPlaylist(current.id)
    await load()
    flash(current.isPublic ? '已改为私有（只有自己可见）' : '已上传云端（所有人可见）')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function renamePlaylist(): Promise<void> {
  const current = detail.value
  if (!current) return
  const name = window.prompt('歌单名', current.name)?.trim()
  if (!name || name === current.name) return
  busy.value = true
  try {
    await updatePlaylist(current.id, { name })
    await openPlaylist(current.id)
    await load()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function removePlaylist(): Promise<void> {
  const current = detail.value
  if (!current) return
  if (!window.confirm(`删除歌单《${current.name}》？歌不会被删除。`)) return
  busy.value = true
  try {
    await deletePlaylist(current.id)
    detail.value = null
    await load()
    flash('歌单已删除')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function addItem(): Promise<void> {
  const current = detail.value
  const title = addTitle.value.trim()
  if (!current || !title) return
  busy.value = true
  error.value = ''
  try {
    await addPlaylistItem(current.id, { title, artist: addArtist.value.trim() })
    addTitle.value = ''
    addArtist.value = ''
    await openPlaylist(current.id)
    await load()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function removeItem(itemId: string): Promise<void> {
  const current = detail.value
  if (!current) return
  busy.value = true
  try {
    await removePlaylistItem(current.id, itemId)
    await openPlaylist(current.id)
    await load()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

/**
 * 点歌单里的唱片就播：把条目还原成 Track。
 * 云端条用 assetId 直链；本地条按 hash 找本地文件；都没有就跳过。
 */
async function playFromPlaylist(startIndex: number): Promise<void> {
  const current = detail.value
  if (!current) return
  const tracks: Track[] = []
  let mappedStart = 0
  for (let i = 0; i < current.items.length; i++) {
    const item = current.items[i]!
    const assetId = (item as { assetId?: string }).assetId ?? ''
    const hash = item.hash ?? ''
    let track: Track | null = null
    if (assetId) {
      track = {
        id: `cloud-${assetId}`,
        title: item.title,
        artist: item.artist || '云端上传',
        source: 'cloud',
        previewUrl: assetUrl(assetId),
        hash,
      }
    } else if (hash) {
      const local = await findTrackByHash(hash)
      if (local) {
        track = {
          id: local.id,
          title: item.title || local.title,
          artist: item.artist || local.artist,
          source: 'local',
          local: true,
          hash: local.hash,
        }
      }
    }
    if (!track) continue
    if (i === startIndex) mappedStart = tracks.length
    tracks.push(track)
  }
  if (!tracks.length) {
    flash('这些歌还没有可播放的音源（需要先传到云端或导入本地）')
    return
  }
  await player.playList(tracks, mappedStart)
}

async function hide(id: string): Promise<void> {
  busy.value = true
  try {
    await hidePlaylist(id)
    if (detail.value?.id === id) detail.value = null
    await load()
    flash('已隐藏，可在下方「已隐藏的歌单」里恢复')
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

async function restore(id: string): Promise<void> {
  busy.value = true
  try {
    await unhidePlaylist(id)
    await load()
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

onMounted(() => void load())

defineExpose({ reload: load })
</script>

<template>
  <div class="playlists">
    <div class="row-head">
      <span class="muted small">
        我的 {{ mine.length }} 个 · 公开的 {{ others.length }} 个
        <template v-if="!auth.loggedIn">（未登录只能看公开歌单）</template>
      </span>
      <div class="head-actions">
        <button type="button" class="btn small-btn" :disabled="busy" @click="creating = !creating">
          {{ creating ? '取消' : '新建歌单' }}
        </button>
        <button type="button" class="btn small-btn" :disabled="loading" @click="load">刷新</button>
      </div>
    </div>

    <p v-if="error" class="notice">{{ error }}</p>
    <p v-if="message" class="notice ok">{{ message }}</p>

    <form v-if="creating" class="create-form" @submit.prevent="submitCreate">
      <input v-model="newName" placeholder="歌单名" maxlength="60" required />
      <input v-model="newDescription" placeholder="描述（可选）" maxlength="200" />
      <label class="check">
        <input v-model="newPublic" type="checkbox" />
        创建后公开到云端（所有人可见）
      </label>
      <button type="submit" class="btn primary" :disabled="busy || !newName.trim()">创建</button>
    </form>

    <p v-if="loading" class="muted small">加载中…</p>

    <!-- 详情 -->
    <section v-if="detail" class="detail">
      <header>
        <div>
          <h3>
            {{ detail.name }}
            <span class="badge" :class="{ pub: detail.isPublic }">{{ detail.isPublic ? '云端公开' : '仅本地可见' }}</span>
          </h3>
          <p class="muted small">
            {{ detail.items.length }} 首 · 由 {{ detail.owner.displayName }} 创建
            <template v-if="detail.description"> · {{ detail.description }}</template>
          </p>
        </div>
        <div class="head-actions">
          <template v-if="detail.mine">
            <button type="button" class="btn small-btn" :disabled="busy" @click="togglePublic">
              {{ detail.isPublic ? '下架（转私有）' : '上传云端' }}
            </button>
            <button type="button" class="btn small-btn" :disabled="busy" @click="renamePlaylist">改名</button>
            <button type="button" class="btn small-btn danger" :disabled="busy" @click="removePlaylist">删除歌单</button>
          </template>
          <button type="button" class="btn small-btn danger" :disabled="busy" @click="hide(detail.id)">隐藏此歌单</button>
          <button type="button" class="btn small-btn" @click="detail = null">关闭</button>
        </div>
      </header>

      <ol v-if="detail.items.length" class="pl-discs">
        <li
          v-for="(item, idx) in pageItems"
          :key="item.id"
          class="pl-disc"
          :class="{ current: player.current?.title === item.title }"
          title="点击播放"
          @click="(event) => !(event.target as HTMLElement).closest('button') && playFromPlaylist(page * PAGE_SIZE + idx)"
        >
          <div class="pl-vinyl">
            <span class="pl-vinyl-label">{{ item.title.slice(0, 1) }}</span>
          </div>
          <b class="pl-disc-title" :title="item.title">{{ item.title }}</b>
          <span class="pl-disc-artist">{{ item.artist || '未知歌手' }}</span>
          <button v-if="detail.mine" type="button" class="pl-disc-del" title="移除" @click="removeItem(item.id)">
            ×
          </button>
        </li>
      </ol>
      <p v-else class="muted small">歌单还是空的。</p>

      <div v-if="pageCount > 1" class="pager">
        <button type="button" class="mini" :disabled="page === 0" @click="gotoPage(page - 1)">上一页</button>
        <span>{{ page + 1 }} / {{ pageCount }}</span>
        <button type="button" class="mini" :disabled="page >= pageCount - 1" @click="gotoPage(page + 1)">下一页</button>
      </div>

      <form v-if="detail.mine" class="add-form" @submit.prevent="addItem">
        <input v-model="addTitle" placeholder="歌名" required maxlength="120" />
        <input v-model="addArtist" placeholder="歌手（可选）" maxlength="80" />
        <button type="submit" class="btn" :disabled="busy || !addTitle.trim()">手动加入</button>
        <button type="button" class="btn" @click="showPickable = !showPickable; if (showPickable && !pickables.length) loadPickables()">
          {{ showPickable ? '收起音乐列表' : '从我的音乐选' }}
        </button>
      </form>

      <div v-if="detail.mine && showPickable" class="pickable">
        <p v-if="pickLoading" class="muted small">读取本地与云端音乐…</p>
        <template v-else>
          <p v-if="!pickables.length" class="muted small">本地和云端都还没有音乐。</p>
          <ul v-else>
            <li v-for="item in pickables" :key="item.key">
              <div class="pick-main">
                <b>{{ item.title }}</b>
                <span>{{ item.artist || '未知歌手' }} · {{ item.where }}</span>
              </div>
              <button type="button" class="mini" :disabled="busy" @click="addPickable(item)">加入</button>
            </li>
          </ul>
        </template>
      </div>
    </section>

    <!-- 列表 -->
    <div v-if="!detail" class="pl-grid">
      <article v-for="item in playlists" :key="item.id" class="pl-card" @click="openPlaylist(item.id)">
        <h4>{{ item.name }}</h4>
        <p class="muted small">
          {{ item.itemCount }} 首 · {{ item.owner.displayName }}
          <span v-if="item.mine" class="tag">我</span>
          <span v-if="!item.isPublic" class="tag">私有</span>
        </p>
        <p v-if="item.description" class="pl-desc">{{ item.description }}</p>
        <div class="pl-actions">
          <button v-if="item.mine" type="button" class="mini" :disabled="busy" @click.stop="hide(item.id)" hidden>
            隐藏
          </button>
          <button
            v-if="!item.mine"
            type="button"
            class="mini danger"
            :disabled="busy"
            @click.stop="hide(item.id)"
          >
            隐藏
          </button>
        </div>
      </article>
      <p v-if="!playlists.length && !loading" class="muted small">还没有歌单，点右上角「新建歌单」。</p>
    </div>

    <section v-if="hiddenOnes.length && !detail" class="hidden-block">
      <h4>已隐藏的歌单</h4>
      <ul>
        <li v-for="item in hiddenOnes" :key="item.id">
          <span>{{ item.name }} · {{ item.owner.displayName }}</span>
          <button type="button" class="mini" :disabled="busy" @click="restore(item.id)">恢复显示</button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.playlists {
  margin-top: 6px;
}
.row-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.create-form,
.add-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
  padding: 12px;
  margin-bottom: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
}
.create-form input,
.add-form input {
  flex: 1;
  min-width: 140px;
  min-height: 38px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: var(--bg);
  color: var(--text);
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  opacity: 0.85;
}
.notice.ok {
  border-color: rgba(88, 214, 141, 0.4);
  background: rgba(88, 214, 141, 0.1);
  color: #58d68d;
}

.pl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px;
}
.pl-card {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
  cursor: pointer;
  transition: 0.16s ease;
}
.pl-card:hover {
  border-color: rgba(124, 196, 255, 0.5);
  transform: translateY(-2px);
}
.pl-card h4 {
  margin: 0 0 6px;
  font-size: 0.95rem;
}
.pl-desc {
  margin: 6px 0 0;
  font-size: 0.78rem;
  opacity: 0.7;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  font-size: 0.68rem;
}
.pl-actions {
  margin-top: 8px;
}
.mini {
  padding: 3px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: none;
  color: inherit;
  font-size: 0.74rem;
  cursor: pointer;
}
.mini.danger:hover {
  color: #ff7b72;
  border-color: rgba(255, 123, 114, 0.5);
}

.detail {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
}
.detail header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
}
.detail h3 {
  margin: 0 0 4px;
  font-size: 1.05rem;
}
.badge {
  margin-left: 8px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--line-strong);
  font-size: 0.7rem;
  font-weight: 400;
}
.badge.pub {
  border-color: rgba(76, 194, 255, 0.5);
  color: #7cc4ff;
}
/* 歌单里的歌也做成唱片 */
.pl-discs {
  margin: 14px 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px 10px;
}
@media (max-width: 900px) {
  .pl-discs {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }
}
@media (max-width: 640px) {
  .pl-discs {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin: 12px 0 4px;
  font-size: 0.8rem;
  opacity: 0.85;
}
.pl-disc {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px 6px;
  border-radius: 12px;
  transition: background 0.16s ease;
  cursor: pointer;
}
.pl-disc:hover {
  background: rgba(255, 255, 255, 0.05);
}
/* 正在播放的那张 */
.pl-disc.current .pl-vinyl {
  box-shadow:
    0 0 0 2px rgba(76, 194, 255, 0.75),
    0 6px 18px rgba(0, 0, 0, 0.5);
}
.pl-disc.current .pl-disc-title {
  color: #7cc4ff;
}
.pl-vinyl {
  width: 82px;
  height: 82px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background:
    repeating-radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.05) 0 1px, transparent 1px 4px),
    radial-gradient(circle at 50% 50%, #0a0d10 0 62%, #060606 63% 100%);
  box-shadow:
    0 6px 16px rgba(0, 0, 0, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  transition: transform 0.2s ease;
}
.pl-disc:hover .pl-vinyl {
  transform: scale(1.05);
}
.pl-vinyl-label {
  display: grid;
  place-items: center;
  width: 46%;
  height: 46%;
  border-radius: 50%;
  background: linear-gradient(140deg, #4cc2ff, #7a6cff);
  color: #04121e;
  font-weight: 700;
  font-size: 0.9rem;
}
.pl-disc-title {
  max-width: 100px;
  font-size: 0.76rem;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pl-disc-artist {
  max-width: 100px;
  font-size: 0.68rem;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pl-disc-del {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--line-strong);
  background: rgba(10, 14, 20, 0.9);
  color: inherit;
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.15s ease;
}
.pl-disc:hover .pl-disc-del {
  opacity: 1;
}
.pl-disc-del:hover {
  color: #ff7b72;
  border-color: rgba(255, 123, 114, 0.5);
}
.pickable {
  margin: 10px 0 4px;
  max-height: 300px;
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  background: rgba(0, 0, 0, 0.15);
}
.pickable ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.pickable li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
}
.pick-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.pick-main b {
  font-size: 0.85rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pick-main span {
  font-size: 0.72rem;
  opacity: 0.6;
}
.hidden-block {
  margin-top: 20px;
}
.hidden-block h4 {
  margin: 0 0 8px;
  font-size: 0.9rem;
}
.hidden-block ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.hidden-block li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--line);
  font-size: 0.82rem;
}
.btn.primary {
  background: #4cc2ff;
  border-color: transparent;
  color: #06222e;
  font-weight: 600;
}
</style>
