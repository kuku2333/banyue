<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useAuthStore } from '@/stores/auth'
import { REGIONS, fetchTopSongs, fingerprint, formatTime, isAudioFile, searchSongs, type Region, type Track } from '@/lib/music'
import { addTrack, deleteTrack, findTrackByHash, getTrackBlob, listTracks, type TrackRecord } from '@/lib/db'
import { assetUrl, deleteAsset, formatSize, getStorage, listAssets, uploadAsset, type CloudAsset, type StorageUsage } from '@/lib/cloud'
import { BILI_HOT, BILI_SNAP } from '@/lib/bili'
import { formatCount } from '@/lib/format'

type Tab = 'charts' | 'search' | 'local' | 'cloud' | 'favs' | 'bili' | 'douyin'

const player = usePlayerStore()
const auth = useAuthStore()
const tab = ref<Tab>('charts')
const region = ref<Region['id']>('hk')
const charts = ref<Track[]>([])
const chartsLoading = ref(false)
const chartsError = ref('')

const term = ref('')
const results = ref<Track[]>([])
const searching = ref(false)
const searchError = ref('')

const local = ref<TrackRecord[]>([])
const importing = ref(false)
const message = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const TABS: { id: Tab; label: string }[] = [
  { id: 'charts', label: '榜单' },
  { id: 'search', label: '搜索' },
  { id: 'local', label: '本地音乐' },
  { id: 'cloud', label: '云端音乐' },
  { id: 'favs', label: '收藏' },
  { id: 'bili', label: 'B站' },
  { id: 'douyin', label: '抖音' },
]

const cloudTracks = ref<CloudAsset[]>([])
const cloudLoading = ref(false)
const cloudBusy = ref('')
const cloudError = ref('')
const storage = ref<StorageUsage | null>(null)

const cloudList = computed<Track[]>(() =>
  cloudTracks.value.map((asset) => ({
    id: `cloud-${asset.id}`,
    title: asset.title,
    artist: asset.subtitle || '云端上传',
    source: 'cloud' as const,
    previewUrl: assetUrl(asset.id),
  })),
)

async function loadCloud(): Promise<void> {
  cloudLoading.value = true
  cloudError.value = ''
  try {
    const [tracks, usage] = await Promise.all([listAssets('track'), getStorage()])
    cloudTracks.value = tracks
    storage.value = usage
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    cloudLoading.value = false
  }
}

async function uploadToCloud(track: Track): Promise<void> {
  cloudBusy.value = track.id
  cloudError.value = ''
  try {
    const blob = await getTrackBlob(track.id)
    if (!blob) throw new Error('本地文件读取失败')
    await uploadAsset('track', blob, {
      title: track.title,
      subtitle: track.artist === '本地文件' ? '' : track.artist,
      filename: track.title,
    })
    message.value = `已把《${track.title}》传到云端`
    setTimeout(() => (message.value = ''), 3000)
    await loadCloud()
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    cloudBusy.value = ''
  }
}

async function removeCloud(asset: CloudAsset): Promise<void> {
  if (!window.confirm(`从云端删除《${asset.title}》？`)) return
  await deleteAsset(asset.id)
  await loadCloud()
}

const localTracks = computed<Track[]>(() =>
  local.value.map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist || '本地文件',
    source: 'local' as const,
    local: true,
    hash: item.hash,
  })),
)

async function loadCharts(): Promise<void> {
  chartsLoading.value = true
  chartsError.value = ''
  try {
    charts.value = await fetchTopSongs(region.value)
  } catch (error) {
    chartsError.value = (error as Error).message
    charts.value = []
  } finally {
    chartsLoading.value = false
  }
}

async function pickRegion(id: Region['id']): Promise<void> {
  region.value = id
  await loadCharts()
}

async function doSearch(): Promise<void> {
  const keyword = term.value.trim()
  if (!keyword) return
  searching.value = true
  searchError.value = ''
  try {
    results.value = await searchSongs(keyword, region.value)
  } catch (error) {
    searchError.value = (error as Error).message
    results.value = []
  } finally {
    searching.value = false
  }
}

async function refreshLocal(): Promise<void> {
  local.value = await listTracks()
}

async function importLocal(files: FileList | File[] | null): Promise<void> {
  if (!files) return
  const list = Array.from(files).filter((file) => isAudioFile(file.name))
  if (!list.length) {
    message.value = '没有可导入的音频文件'
    return
  }
  importing.value = true
  let added = 0
  let skipped = 0
  for (const file of list) {
    try {
      const buffer = await file.arrayBuffer()
      const hash = await fingerprint(buffer, `${file.name}-${file.size}`)
      const exists = await findTrackByHash(hash)
      if (exists) {
        skipped++
        continue
      }
      await addTrack({
        id: hash,
        title: file.name.replace(/\.[^.]+$/, ''),
        artist: '',
        size: file.size,
        hash,
        createdAt: Date.now(),
        data: file,
      })
      added++
    } catch {
      skipped++
    }
  }
  await refreshLocal()
  importing.value = false
  message.value = `新增 ${added} 首${skipped ? ` · 跳过 ${skipped} 首（重复或失败）` : ''}`
  setTimeout(() => (message.value = ''), 4000)
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  void importLocal(input.files)
  input.value = ''
}

async function removeLocal(id: string): Promise<void> {
  await deleteTrack(id)
  await refreshLocal()
}

function playFrom(list: Track[], index: number): void {
  const track = list[index]
  if (track && isCurrent(track)) {
    void player.toggle()
    return
  }
  void player.playList(list, index)
}

function isCurrent(track: Track): boolean {
  return player.current?.id === track.id
}

onMounted(() => {
  void loadCharts()
  void refreshLocal()
  void loadCloud()
})
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Music · 听歌</span>
      <h1>听歌</h1>
      <p>榜单来自 Apple Music 公开接口，试听 30 秒；双击任意一行播放/暂停，空格也能暂停或继续。</p>
    </div>

    <div class="chips" role="tablist" aria-label="音乐来源">
      <button
        v-for="item in TABS"
        :key="item.id"
        type="button"
        class="chip"
        :class="{ on: tab === item.id }"
        role="tab"
        :aria-selected="tab === item.id"
        @click="tab = item.id"
      >
        {{ item.label }}
      </button>
    </div>

    <!-- 榜单 -->
    <section v-if="tab === 'charts'" class="panel">
      <div class="row-head">
        <div class="chips">
          <button
            v-for="item in REGIONS"
            :key="item.id"
            type="button"
            class="chip small"
            :class="{ on: region === item.id }"
            @click="pickRegion(item.id)"
          >
            {{ item.label }}
          </button>
        </div>
        <button type="button" class="btn small-btn" @click="loadCharts">刷新</button>
      </div>

      <p v-if="chartsLoading" class="empty">正在取榜单…</p>
      <p v-else-if="chartsError" class="notice">{{ chartsError }}（Apple 接口偶尔会限流，稍后再试）</p>
      <ol v-else class="track-list">
        <li
          v-for="(track, index) in charts"
          :key="track.id"
          :class="{ playing: isCurrent(track) }"
          title="双击播放 / 暂停"
          @dblclick="player.toggleAt(charts, index)"
        >
          <span class="num">{{ String(index + 1).padStart(2, '0') }}</span>
          <div class="t-main">
            <b>{{ track.title }}</b>
            <span>{{ track.artist }}</span>
          </div>
          <button type="button" class="play" :aria-label="`播放 ${track.title}`" @click="playFrom(charts, index)">
            {{ isCurrent(track) && player.playing ? '暂停' : '播放' }}
          </button>
          <button
            type="button"
            class="star"
            :class="{ on: player.isFavorite(track.id) }"
            :aria-label="player.isFavorite(track.id) ? '取消收藏' : '收藏'"
            @click="player.toggleFavorite(track)"
          >
            ★
          </button>
        </li>
      </ol>
    </section>

    <!-- 搜索 -->
    <section v-else-if="tab === 'search'" class="panel">
      <form class="search-row" @submit.prevent="doSearch">
        <input v-model="term" type="search" placeholder="歌名或歌手，例如「陈奕迅」" aria-label="搜索歌曲" />
        <button type="submit" class="btn" :disabled="searching">{{ searching ? '搜索中…' : '搜索' }}</button>
      </form>
      <div class="chips region-row">
        <button
          v-for="item in REGIONS"
          :key="item.id"
          type="button"
          class="chip small"
          :class="{ on: region === item.id }"
          @click="region = item.id"
        >
          {{ item.label }}
        </button>
      </div>
      <p v-if="searchError" class="notice">{{ searchError }}</p>
      <ol v-if="results.length" class="track-list">
        <li
          v-for="(track, index) in results"
          :key="track.id"
          :class="{ playing: isCurrent(track) }"
          title="双击播放 / 暂停"
          @dblclick="player.toggleAt(results, index)"
        >
          <div class="t-main">
            <b>{{ track.title }}</b>
            <span>{{ track.artist }} · {{ track.album ?? '单曲' }}</span>
          </div>
          <span class="dur">{{ track.duration ? formatTime(track.duration) : '0:30' }}</span>
          <button type="button" class="play" @click="playFrom(results, index)">
            {{ isCurrent(track) && player.playing ? '暂停' : '播放' }}
          </button>
          <button
            type="button"
            class="star"
            :class="{ on: player.isFavorite(track.id) }"
            :aria-label="player.isFavorite(track.id) ? '取消收藏' : '收藏'"
            @click="player.toggleFavorite(track)"
          >
            ★
          </button>
        </li>
      </ol>
      <p v-else-if="!searching" class="empty">搜一下试试。结果带 30 秒试听。</p>
    </section>

    <!-- 本地音乐 -->
    <section v-else-if="tab === 'local'" class="panel">
      <div class="local-head">
        <button type="button" class="btn" :disabled="importing" @click="fileInput?.click()">
          {{ importing ? '导入中…' : '导入音乐文件' }}
        </button>
        <input
          id="music-file-input"
          ref="fileInput"
          type="file"
          accept="audio/*,.mp3,.m4a,.flac,.wav,.ogg"
          multiple
          hidden
          @change="onPick"
        />
        <span class="muted small">支持 mp3 / m4a / flac / wav / ogg，按内容指纹去重</span>
      </div>
      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="cloudError" class="notice">{{ cloudError }}</p>
      <p class="muted small">本地共 {{ local.length }} 首，存在浏览器 IndexedDB 里。</p>

      <ol v-if="localTracks.length" class="track-list">
        <li
          v-for="(track, index) in localTracks"
          :key="track.id"
          :class="{ playing: isCurrent(track) }"
          title="双击播放 / 暂停"
          @dblclick="player.toggleAt(localTracks, index)"
        >
          <div class="t-main">
            <b>{{ track.title }}</b>
            <span>{{ track.artist }} · #{{ track.hash?.slice(0, 6) }}</span>
          </div>
          <button type="button" class="play" @click="playFrom(localTracks, index)">
            {{ isCurrent(track) && player.playing ? '暂停' : '播放' }}
          </button>
          <button
            type="button"
            class="star"
            :class="{ on: player.isFavorite(track.id) }"
            @click="player.toggleFavorite(track)"
          >
            ★
          </button>
          <button type="button" class="cloud-btn" :disabled="cloudBusy === track.id" @click="uploadToCloud(track)">
            {{ cloudBusy === track.id ? '上传中…' : '传到云端' }}
          </button>
          <button type="button" class="del" @click="removeLocal(track.id)">删除</button>
        </li>
      </ol>
      <p v-else class="empty">还没有本地音乐。导入几首，退出浏览器也还在。</p>
    </section>

    <!-- 云端音乐 -->
    <section v-else-if="tab === 'cloud'" class="panel">
      <div class="row-head">
        <span class="muted small">
          云端共 {{ cloudTracks.length }} 首 · 所有人可听
          <template v-if="storage"> · 我的空间已用 {{ formatSize(storage.used) }} / {{ formatSize(storage.quota) }}</template>
        </span>
        <button type="button" class="btn small-btn" @click="loadCloud">刷新</button>
      </div>
      <p v-if="cloudError" class="notice">{{ cloudError }}</p>
      <p v-if="cloudLoading" class="muted small">加载中…</p>
      <ol v-else-if="cloudList.length" class="track-list">
        <li
          v-for="(track, index) in cloudList"
          :key="track.id"
          :class="{ playing: isCurrent(track) }"
          title="双击播放 / 暂停"
          @dblclick="player.toggleAt(cloudList, index)"
        >
          <div class="t-main">
            <b>{{ track.title }}</b>
            <span>{{ cloudTracks[index]?.owner.displayName }} · {{ formatSize(cloudTracks[index]?.size ?? 0) }}</span>
          </div>
          <button type="button" class="play" @click="playFrom(cloudList, index)">
            {{ isCurrent(track) && player.playing ? '暂停' : '播放' }}
          </button>
          <button
            v-if="cloudTracks[index]?.mine || auth.user?.isAdmin"
            type="button"
            class="del"
            @click="removeCloud(cloudTracks[index]!)"
          >
            删除
          </button>
        </li>
      </ol>
      <p v-else class="empty">云端还没有音乐。把「本地音乐」里的歌传到云端，别人也能听。</p>
    </section>

    <!-- 收藏 -->
    <section v-else-if="tab === 'favs'" class="panel">
      <div class="row-head">
        <span class="muted small">共 {{ player.favorites.length }} 首</span>
        <div class="head-actions">
          <button
            type="button"
            class="btn small-btn"
            :disabled="!player.favorites.length && !localTracks.length"
            title="播放顺序：收藏 → 本地"
            @click="playFrom([...player.favorites, ...localTracks], 0)"
          >
            收藏 + 本地一起播
          </button>
          <button type="button" class="btn small-btn" :disabled="!player.favorites.length" @click="playFrom(player.favorites, 0)">
            播放全部
          </button>
        </div>
      </div>
      <ol v-if="player.favorites.length" class="track-list">
        <li
          v-for="(track, index) in player.favorites"
          :key="track.id"
          :class="{ playing: isCurrent(track) }"
          title="双击播放 / 暂停"
          @dblclick="player.toggleAt(player.favorites, index)"
        >
          <div class="t-main">
            <b>{{ track.title }}</b>
            <span>{{ track.artist || (track.local ? '本地文件' : '') }}</span>
          </div>
          <button type="button" class="play" @click="playFrom(player.favorites, index)">
            {{ isCurrent(track) && player.playing ? '暂停' : '播放' }}
          </button>
          <button type="button" class="star on" @click="player.toggleFavorite(track)">★</button>
        </li>
      </ol>
      <p v-else class="empty">还没有收藏。榜单或搜索里点 ★ 加进来。</p>
    </section>

    <!-- B 站 -->
    <section v-else-if="tab === 'bili'" class="panel">
      <p class="muted small">
        B 站音乐区排行快照（{{ BILI_SNAP }}）。浏览器端拿不到实时接口，点开是原视频页面。
      </p>
      <ol class="track-list">
        <li v-for="item in BILI_HOT" :key="item.rank">
          <span class="num">{{ String(item.rank).padStart(2, '0') }}</span>
          <div class="t-main">
            <b>{{ item.title }}</b>
            <span>{{ item.up }} · {{ formatCount(item.view) }} 播放</span>
          </div>
          <a class="play" :href="item.url" target="_blank" rel="noopener noreferrer">去看</a>
        </li>
      </ol>
    </section>

    <!-- 抖音 -->
    <section v-else class="panel">
      <p class="muted small">
        抖音没有可跨域读取的音乐榜接口，所以这里只放两个直达入口。想听完整版就导入自己的文件。
      </p>
      <div class="douyin-links">
        <a class="btn" href="https://music.douyin.com/" target="_blank" rel="noopener noreferrer">抖音音乐榜</a>
        <a class="btn" href="https://www.douyin.com/hot" target="_blank" rel="noopener noreferrer">抖音热榜</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
.panel {
  margin-top: 20px;
}

.chips.small .chip,
.chip.small {
  padding: 5px 12px;
  font-size: 0.78rem;
}

.row-head,
.local-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.local-head {
  justify-content: flex-start;
}

.small {
  font-size: 0.78rem;
}

.small-btn {
  padding: 6px 14px;
  font-size: 0.8rem;
}

.head-actions {
  display: flex;
  gap: 8px;
}

.track-list {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--line);
}

.track-list li {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 11px 10px;
  border-bottom: 1px solid var(--line);
  transition: background 0.15s ease;
  cursor: pointer;
  user-select: none;
}

.track-list li:hover {
  background: var(--card);
}

.track-list li.playing {
  background: var(--accent-soft);
}

.track-list li.playing b {
  color: var(--accent);
}

.num {
  width: 26px;
  color: var(--dim);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.t-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
  line-height: 1.4;
}

.t-main b {
  font-size: 0.92rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.t-main span {
  color: var(--muted);
  font-size: 0.76rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dur {
  color: var(--dim);
  font-size: 0.74rem;
  font-variant-numeric: tabular-nums;
}

.play,
.star,
.del,
.cloud-btn {
  flex: none;
  padding: 5px 12px;
  border-radius: 8px;
  border: 1px solid var(--line);
  color: var(--text-2);
  font-size: 0.78rem;
  transition: 0.15s ease;
}

.play:hover,
.star:hover,
.cloud-btn:hover {
  color: var(--accent);
  border-color: var(--accent-line);
}

.star {
  padding: 5px 9px;
  color: var(--dim);
}

.star.on {
  color: var(--accent);
  border-color: var(--accent-line);
}

.del {
  color: var(--dim);
}

.del:hover {
  color: var(--danger);
  border-color: rgba(251, 113, 133, 0.4);
}

.cloud-btn {
  color: var(--dim);
  font-size: 0.74rem;
}

.cloud-btn:disabled {
  opacity: 0.5;
}

.search-row {
  display: flex;
  gap: 10px;
}

.search-row input {
  flex: 1;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--line-strong);
  background: var(--card);
  color: var(--text);
  font-size: 1rem;
  outline: none;
}

.search-row input:focus {
  border-color: var(--accent-line);
}

.region-row {
  margin: 12px 0;
}

.notice {
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--accent-line);
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 0.82rem;
}

.douyin-links {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
</style>
