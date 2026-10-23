<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useAuthStore } from '@/stores/auth'
import { REGIONS, fetchTopSongs, fingerprint, isAudioFile, searchSongs, type Region, type Track } from '@/lib/music'
import { addTrack, deleteTrack, findTrackByHash, getTrackBlob, listTracks, type TrackRecord } from '@/lib/db'
import { isLyricFile, readEmbeddedLyrics } from '@/lib/lyrics'
import { assetUrl, deleteAsset, formatSize, getStorage, listAssets, syncTracksToCloud, uploadAsset, type CloudAsset, type StorageUsage } from '@/lib/cloud'
import BatchBar from '@/components/BatchBar.vue'
import Turntable from '@/components/Turntable.vue'
import LyricsPanel from '@/components/LyricsPanel.vue'
import RecordWall from '@/components/RecordWall.vue'
import PlaylistPanel from '@/components/PlaylistPanel.vue'
import PlaylistPicker from '@/components/PlaylistPicker.vue'

type Tab = 'local' | 'cloud' | 'charts' | 'search' | 'playlists' | 'favs'

const player = usePlayerStore()
const auth = useAuthStore()
const tab = ref<Tab>('local')
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
  { id: 'local', label: '本地音乐' },
  { id: 'cloud', label: '云端音乐' },
  { id: 'charts', label: '榜单' },
  { id: 'search', label: '搜索' },
  { id: 'playlists', label: '歌单' },
  { id: 'favs', label: '收藏' },
]

const cloudTracks = ref<CloudAsset[]>([])
const cloudLoading = ref(false)
const cloudBusy = ref('')
const cloudError = ref('')
const storage = ref<StorageUsage | null>(null)
const syncing = ref(false)
const syncProgress = ref('')
const downloading = ref(false)
const downloadProgress = ref('')

const cloudList = computed<Track[]>(() =>
  cloudTracks.value.map((asset) => ({
    id: `cloud-${asset.id}`,
    title: asset.title,
    artist: asset.subtitle || '云端上传',
    source: 'cloud' as const,
    previewUrl: assetUrl(asset.id),
    // 带上指纹：本地若已有同一首，播放时优先走本地
    hash: asset.hash,
    art: asset.cover || undefined,
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

/** 一键同步：本地音乐里云端还没有的自动上传，云端已有的跳过 */
async function syncAllToCloud(): Promise<void> {
  if (syncing.value) return
  if (!auth.loggedIn) {
    auth.openDialog()
    return
  }
  if (!local.value.length) {
    message.value = '本地还没有音乐，先去「本地音乐」导入几首'
    setTimeout(() => (message.value = ''), 3000)
    return
  }
  syncing.value = true
  syncProgress.value = '准备中…'
  cloudError.value = ''
  try {
    const tracks = local.value.map((item) => ({
      id: item.id,
      title: item.title,
      artist: item.artist || '本地文件',
      hash: item.hash,
    }))
    const result = await syncTracksToCloud(tracks, getTrackBlob, (done, total) => {
      syncProgress.value = `同步中 ${done}/${total}`
    })
    message.value = `同步完成：新传 ${result.uploaded} · 跳过 ${result.skipped} · 失败 ${result.failed}`
    setTimeout(() => (message.value = ''), 5000)
    await loadCloud()
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    syncing.value = false
    syncProgress.value = ''
  }
}

/** 云端一首歌下到本地库（按内容指纹去重），返回结果 */
async function saveCloudTrackToLocal(asset: CloudAsset): Promise<'added' | 'skipped'> {
  if (asset.hash && (await findTrackByHash(asset.hash))) return 'skipped'
  const response = await fetch(assetUrl(asset.id))
  if (!response.ok) throw new Error(`下载失败（${response.status}）`)
  const blob = await response.blob()
  await addTrack({
    id: asset.hash || `cloud-${asset.id}`,
    title: asset.title.replace(/\.[^.]+$/, ''),
    artist: asset.subtitle || '云端下载',
    size: asset.size,
    hash: asset.hash || '',
    createdAt: Date.now(),
    data: blob,
  })
  return 'added'
}

/** 云端单曲下载到本地 */
async function downloadToLocal(asset: CloudAsset): Promise<void> {
  if (cloudBusy.value === asset.id) return
  cloudBusy.value = asset.id
  cloudError.value = ''
  try {
    const result = await saveCloudTrackToLocal(asset)
    if (result === 'skipped') {
      message.value = `《${asset.title}》本地已有，跳过`
    } else {
      await refreshLocal()
      message.value = `《${asset.title}》已下载到本地`
    }
    setTimeout(() => (message.value = ''), 3000)
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    cloudBusy.value = ''
  }
}

/** 一键下载：云端全部歌下到本地，本地已有的按指纹跳过 */
async function downloadAllToLocal(): Promise<void> {
  if (downloading.value) return
  if (!cloudTracks.value.length) {
    message.value = '云端还没有音乐'
    setTimeout(() => (message.value = ''), 3000)
    return
  }
  downloading.value = true
  downloadProgress.value = '准备中…'
  cloudError.value = ''
  let downloaded = 0
  let skipped = 0
  let failed = 0
  for (let i = 0; i < cloudTracks.value.length; i++) {
    const asset = cloudTracks.value[i]!
    downloadProgress.value = `下载中 ${i + 1}/${cloudTracks.value.length}`
    try {
      const result = await saveCloudTrackToLocal(asset)
      if (result === 'skipped') skipped++
      else downloaded++
    } catch {
      failed++
    }
  }
  await refreshLocal()
  message.value = `下载完成：新增 ${downloaded} · 跳过 ${skipped} · 失败 ${failed}`
  setTimeout(() => (message.value = ''), 5000)
  downloading.value = false
  downloadProgress.value = ''
}

/* 批量删除（本地音乐 / 云端音乐通用） */
const selectMode = ref(false)
const selected = ref<string[]>([])
const batchBusy = ref(false)

function enterSelectMode(): void {
  selectMode.value = true
  selected.value = []
}
function exitSelectMode(): void {
  selectMode.value = false
  selected.value = []
}
function toggleSelect(id: string): void {
  selected.value = selected.value.includes(id)
    ? selected.value.filter((item) => item !== id)
    : [...selected.value, id]
}
function toggleAll(ids: string[]): void {
  selected.value = selected.value.length >= ids.length ? [] : [...ids]
}

/** 云端可删项（自己的或管理员可删任意） */
function cloudDeletable(asset: CloudAsset | undefined): boolean {
  return Boolean(asset && (asset.mine || auth.user?.isAdmin))
}
const cloudDeletableIds = computed(() =>
  cloudTracks.value.filter((asset) => cloudDeletable(asset)).map((asset) => asset.id),
)

/** 全选：当前 tab 的可删项 */
function currentIds(): string[] {
  return tab.value === 'cloud' ? cloudDeletableIds.value : localTracks.value.map((track) => track.id)
}
function toggleAllCurrent(): void {
  toggleAll(currentIds())
}

/** 批量删除本地音乐（IndexedDB） */
async function batchDeleteLocal(): Promise<void> {
  if (!selected.value.length || batchBusy.value) return
  if (!window.confirm(`删除选中的 ${selected.value.length} 首本地音乐？`)) return
  batchBusy.value = true
  try {
    for (const id of selected.value) await deleteTrack(id)
    await refreshLocal()
    message.value = `已删除 ${selected.value.length} 首本地音乐`
    setTimeout(() => (message.value = ''), 3000)
    exitSelectMode()
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    batchBusy.value = false
  }
}

/** 批量删除云端音乐（服务端） */
async function batchDeleteCloud(): Promise<void> {
  if (!selected.value.length || batchBusy.value) return
  if (!window.confirm(`从云端删除选中的 ${selected.value.length} 首？`)) return
  batchBusy.value = true
  try {
    let failed = 0
    for (const id of selected.value) {
      try {
        await deleteAsset(id)
      } catch {
        failed++
      }
    }
    message.value = failed
      ? `云端删除完成，${failed} 首失败`
      : `已从云端删除 ${selected.value.length} 首`
    setTimeout(() => (message.value = ''), 3000)
    await loadCloud()
    exitSelectMode()
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    batchBusy.value = false
  }
}

const localTracks = computed<Track[]>(() =>
  local.value.map((item) => ({
    id: item.id,
    title: item.title,
    artist: item.artist || '本地文件',
    source: 'local' as const,
    local: true,
    hash: item.hash,
    art: item.cover || undefined,
    lyrics: item.lyrics || undefined,
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

/** 保存歌词到当前播放的本地曲目 */
async function saveLyrics(text: string): Promise<void> {
  const track = player.current
  if (!track) return
  if (track.id.startsWith('cloud-')) {
    cloudError.value = '云端歌曲暂不支持保存歌词'
    return
  }
  const records = await listTracks()
  const record = records.find((item) => item.id === track.id)
  if (!record) return
  await addTrack({ ...record, lyrics: text })
  const queue = player.queue
  const index = queue.findIndex((item) => item.id === track.id)
  if (index >= 0) queue[index] = { ...queue[index]!, lyrics: text }
  player.markLibraryChanged()
}

/** 一键导出当前列表的所有歌名（每行一句），方便去别处找歌词 */
function exportTrackNames(): void {
  const names = local.value.map((item) => item.title).filter(Boolean)
  if (!names.length) {
    message.value = '本地还没有歌可以导出'
    setTimeout(() => (message.value = ''), 3000)
    return
  }
  const text = names.join(String.fromCharCode(10)) + String.fromCharCode(10)
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor2 = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 10)
  anchor2.href = url
  anchor2.download = `本地歌名-${stamp}.txt`
  anchor2.click()
  setTimeout(() => URL.revokeObjectURL(url), 3000)
  message.value = `已导出 ${names.length} 个歌名`
  setTimeout(() => (message.value = ''), 3000)
}

const lyricInput = ref<HTMLInputElement | null>(null)
const lyricImporting = ref(false)

/** 一键导入歌词：多个 .lrc/.txt，按文件名的歌名去匹配本地歌曲 */
async function importLyricFiles(files: FileList | File[] | null): Promise<void> {
  if (!files) return
  const picked = Array.from(files).filter((file) => isLyricFile(file.name))
  if (!picked.length) {
    message.value = '请选择 .lrc 或 .txt 歌词文件'
    setTimeout(() => (message.value = ''), 3000)
    return
  }
  lyricImporting.value = true
  let matched = 0
  let missed = 0
  try {
    const records = await listTracks()
    // 歌名归一化：小写、去掉空白/标点差异，匹配更宽容
    const norm = (text: string): string =>
      String(text ?? '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[\-_.·、,，。!！?？'"“”（）()\[\]【】]/g, '')
    const byName = new Map<string, TrackRecord>()
    for (const item of records) byName.set(norm(item.title), item)

    for (const file of picked) {
      const baseName = file.name.replace(/\.[^.]+$/, '')
      const target = byName.get(norm(baseName))
      if (!target) {
        missed++
        continue
      }
      const text = await file.text()
      if (!text.trim()) {
        missed++
        continue
      }
      await addTrack({ ...target, lyrics: text })
      matched++
    }
    await refreshLocal()
    message.value = `歌词导入完成：匹配 ${matched} 首${missed ? ` · 没匹配上 ${missed} 个` : ''}`
    setTimeout(() => (message.value = ''), 5000)
  } catch (err) {
    cloudError.value = (err as Error).message
  } finally {
    lyricImporting.value = false
    if (lyricInput.value) lyricInput.value.value = ''
  }
}

async function importLocal(files: FileList | File[] | null): Promise<void> {
  if (!files) return
  const all = Array.from(files)
  const list = all.filter((file) => isAudioFile(file.name))
  if (!list.length) {
    message.value = '没有可导入的音频文件'
    return
  }
  // 同时选了 .lrc：按「文件名（不含扩展名）」配对
  const lyricFiles = new Map<string, File>()
  for (const file of all) {
    if (isLyricFile(file.name) && !isAudioFile(file.name)) {
      lyricFiles.set(file.name.replace(/\.[^.]+$/, '').toLowerCase(), file)
    }
  }
  importing.value = true
  let added = 0
  let skipped = 0
  let withLyrics = 0
  try {
    for (const file of list) {
      try {
        const buffer = await file.arrayBuffer()
        const hash = await fingerprint(buffer, `${file.name}-${file.size}`)
        const baseName = file.name.replace(/\.[^.]+$/, '')
        const exists = await findTrackByHash(hash)
        // 先看同名 .lrc，再试音频内嵌歌词
        const paired = lyricFiles.get(baseName.toLowerCase())
        let lyrics = paired ? await paired.text() : ''
        if (!lyrics.trim()) lyrics = await readEmbeddedLyrics(file)
        if (exists) {
          // 已存在但这次带了歌词：补上
          if (lyrics.trim() && !exists.lyrics) {
            await addTrack({ ...exists, lyrics })
            withLyrics++
          }
          skipped++
          continue
        }
        await addTrack({
          id: hash,
          title: baseName,
          artist: '',
          size: file.size,
          hash,
          createdAt: Date.now(),
          data: file,
          lyrics: lyrics.trim() ? lyrics : undefined,
        })
        if (lyrics.trim()) withLyrics++
        added++
      } catch {
        skipped++
      }
    }
    await refreshLocal()
  } finally {
    // 中途抛错也要把按钮解锁，否则会一直显示「导入中…」
    importing.value = false
  }
  message.value = `新增 ${added} 首${withLyrics ? `，${withLyrics} 首带歌词` : ''}${skipped ? ` · 跳过 ${skipped} 首（重复或失败）` : ''}`
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

/* 加歌单：★ 按钮统一走歌单选择器 */
const pickerOpen = ref(false)
const pickerTrack = ref<Track | null>(null)

function openPicker(track: Track): void {
  pickerTrack.value = track
  pickerOpen.value = true
}

/** 云端曲 id 形如 cloud-<assetId>，拆出来给歌单条目用 */
function assetIdOf(track: Track | null): string {
  if (!track) return ''
  return track.id.startsWith('cloud-') ? track.id.slice(6) : ''
}

onMounted(() => {
  void loadCharts()
  void refreshLocal()
  void loadCloud()
})

// 别处改了歌名/歌手等元数据（比如悬浮窗编辑），这里重新读库，界面立刻同步
watch(
  () => player.libraryRev,
  () => {
    void refreshLocal()
    void loadCloud()
  },
)
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Music · 听歌</span>
      <h1>听歌</h1>
    </div>

    <div class="music-stage">
      <aside class="stage-left">
        <Turntable class="tt-wrap">
          <LyricsPanel
            v-if="player.current"
            :track="player.current"
            :current-time="player.currentTime"
            :lyrics="player.current?.lyrics ?? ''"
            @load="saveLyrics"
          />
        </Turntable>
      </aside>

      <div class="stage-right">
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

      <p class="chart-hint">榜单来自 Apple Music 公开接口，每首只能试听 30 秒。</p>
      <p v-if="chartsLoading" class="empty">正在取榜单…</p>
      <p v-else-if="chartsError" class="notice">{{ chartsError }}（Apple 接口偶尔会限流，稍后再试）</p>
      <RecordWall
        v-else
        :tracks="charts"
        :current-id="player.current?.id"
        :playing="player.playing"
        @play="(index) => playFrom(charts, index)"
      >
        <template #actions="{ track }">
          <button
            type="button"
            class="mini-act"
            :class="{ on: player.isFavorite(track.id) }"
            aria-label="加入歌单"
            title="加入歌单"
            @click="openPicker(track)"
          >
            ★
          </button>
        </template>
      </RecordWall>
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
      <RecordWall
        v-if="results.length"
        :tracks="results"
        :current-id="player.current?.id"
        :playing="player.playing"
        @play="(index) => playFrom(results, index)"
      >
        <template #actions="{ track }">
          <button
            type="button"
            class="mini-act"
            :class="{ on: player.isFavorite(track.id) }"
            aria-label="加入歌单"
            title="加入歌单"
            @click="openPicker(track)"
          >
            ★
          </button>
        </template>
      </RecordWall>
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
        <button
          v-if="localTracks.length"
          type="button"
          class="btn small-btn"
          :class="{ on: selectMode }"
          @click="selectMode ? exitSelectMode() : enterSelectMode()"
        >
          {{ selectMode ? '完成' : '批量管理' }}
        </button>
        <button
          v-if="localTracks.length"
          type="button"
          class="btn small-btn"
          title="导出本地歌曲名，每行一个"
          @click="exportTrackNames"
        >
          导出歌名
        </button>
        <button
          type="button"
          class="btn small-btn"
          :disabled="lyricImporting"
          title="批量选择 .lrc / .txt，按歌名自动匹配"
          @click="lyricInput?.click()"
        >
          {{ lyricImporting ? '导入中…' : '导入歌词' }}
        </button>
        <input
          id="lyric-file-input"
          ref="lyricInput"
          type="file"
          accept=".lrc,.txt,text/plain"
          multiple
          hidden
          @change="(event) => importLyricFiles((event.target as HTMLInputElement).files)"
        />
        <span class="muted small">支持 mp3 / m4a / flac / wav / ogg，按内容指纹去重</span>
      </div>
      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="cloudError" class="notice">{{ cloudError }}</p>
      <p class="muted small">本地共 {{ local.length }} 首，存在浏览器 IndexedDB 里。</p>

      <RecordWall
        v-if="localTracks.length"
        :tracks="localTracks"
        :current-id="player.current?.id"
        :playing="player.playing"
        :select-mode="selectMode"
        :selected-ids="selected"
        :selectable="() => true"
        @play="(index) => playFrom(localTracks, index)"
        @select="toggleSelect"
      >
        <template #actions="{ track }">
          <template v-if="!selectMode">
            <button
              type="button"
              class="mini-act"
              :class="{ on: player.isFavorite(track.id) }"
              title="加入歌单"
              @click="openPicker(track)"
            >
              ★
            </button>
            <button
              type="button"
              class="mini-act"
              :disabled="cloudBusy === track.id"
              title="传到云端"
              @click="uploadToCloud(track)"
            >
              ↑
            </button>
            <button type="button" class="mini-act danger" title="删除" @click="removeLocal(track.id)">×</button>
          </template>
        </template>
      </RecordWall>
      <p v-else class="empty">还没有本地音乐。导入几首，退出浏览器也还在。</p>
    </section>

    <!-- 云端音乐 -->
    <section v-else-if="tab === 'cloud'" class="panel">
      <div class="row-head">
        <span class="muted small">
          云端共 {{ cloudTracks.length }} 首 · 所有人可听
          <template v-if="storage"> · 我的空间已用 {{ formatSize(storage.used) }} / {{ formatSize(storage.quota) }}</template>
        </span>
        <div class="head-actions">
          <button
            type="button"
            class="btn small-btn"
            :disabled="syncing"
            @click="syncAllToCloud"
          >
            {{ syncing ? (syncProgress || '同步中…') : '一键同步' }}
          </button>
          <button
            type="button"
            class="btn small-btn"
            :disabled="downloading"
            title="云端全部歌下载到本地（本地已有的跳过）"
            @click="downloadAllToLocal"
          >
            {{ downloading ? (downloadProgress || '下载中…') : '一键下载' }}
          </button>
          <button
            v-if="cloudDeletableIds.length"
            type="button"
            class="btn small-btn"
            :class="{ on: selectMode }"
            @click="selectMode ? exitSelectMode() : enterSelectMode()"
          >
            {{ selectMode ? '完成' : '批量管理' }}
          </button>
          <button type="button" class="btn small-btn" @click="loadCloud">刷新</button>
        </div>
      </div>
      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="cloudError" class="notice">{{ cloudError }}</p>
      <p v-if="cloudLoading" class="muted small">加载中…</p>
      <RecordWall
        v-else-if="cloudList.length"
        :tracks="cloudList"
        :current-id="player.current?.id"
        :playing="player.playing"
        :select-mode="selectMode"
        :selected-ids="selected"
        :selectable="(_track, index) => cloudDeletable(cloudTracks[index])"
        @play="(index) => playFrom(cloudList, index)"
        @select="toggleSelect"
      >
        <template #actions="{ track, index }">
          <template v-if="!selectMode">
            <button
              type="button"
              class="mini-act"
              title="加入歌单"
              @click="openPicker(track)"
            >
              ★
            </button>
            <button
              type="button"
              class="mini-act"
              :disabled="cloudBusy === cloudTracks[index]?.id"
              title="下载到本地（本地已有同文件会跳过）"
              @click="cloudTracks[index] && downloadToLocal(cloudTracks[index]!)"
            >
              ↓
            </button>
            <button
              v-if="cloudDeletable(cloudTracks[index])"
              type="button"
              class="mini-act danger"
              title="删除"
              @click="removeCloud(cloudTracks[index]!)"
            >
              ×
            </button>
            <span class="mini-meta">{{ formatSize(cloudTracks[index]?.size ?? 0) }}</span>
          </template>
        </template>
      </RecordWall>
      <p v-else class="empty">云端还没有音乐。把「本地音乐」里的歌传到云端，别人也能听。</p>
    </section>

    <!-- 歌单 -->
    <section v-else-if="tab === 'playlists'" class="panel">
      <PlaylistPanel />
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
      <RecordWall
        v-if="player.favorites.length"
        :tracks="player.favorites"
        :current-id="player.current?.id"
        :playing="player.playing"
        @play="(index) => playFrom(player.favorites, index)"
      >
        <template #actions="{ track }">
          <button type="button" class="mini-act on" title="取消收藏" @click="player.toggleFavorite(track)">★</button>
        </template>
      </RecordWall>
      <p v-else class="empty">还没有收藏。榜单或搜索里点 ★ 加进来。</p>
    </section>

      </div>
    </div>

    <PlaylistPicker
      :open="pickerOpen"
      :track-title="pickerTrack?.title ?? ''"
      :track-artist="pickerTrack?.artist ?? ''"
      :track-hash="pickerTrack?.hash ?? ''"
      :track-asset-id="assetIdOf(pickerTrack)"
      @update:open="pickerOpen = $event"
    />

    <BatchBar
      v-if="selectMode"
      :count="selected.length"
      :total="currentIds().length"
      :busy="batchBusy"
      @toggle-all="toggleAllCurrent"
      @delete="tab === 'cloud' ? batchDeleteCloud() : batchDeleteLocal()"
      @cancel="exitSelectMode"
    />
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


/* 唱片机 + 唱片墙 两栏 */
.music-stage {
  display: grid;
  grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}
.stage-left {
  position: sticky;
  top: 84px;
}
.stage-left .tt-wrap {
  margin: 0;
}
.stage-right {
  min-width: 0;
}

@media (max-width: 980px) {
  .music-stage {
    grid-template-columns: 1fr;
  }
  .stage-left {
    position: static;
  }
}

/* 唱片上的小操作按钮（悬停显示） */
.mini-act {
  min-width: 24px;
  height: 24px;
  padding: 0 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  color: #d7e2ec;
  font-size: 0.78rem;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.16s ease;
}
.record:hover .mini-act,
.record:focus-within .mini-act {
  opacity: 1;
}
.mini-act:hover {
  background: rgba(255, 255, 255, 0.16);
}
.mini-act.on {
  color: #ffd166;
  border-color: rgba(255, 209, 102, 0.45);
}
.mini-act.danger:hover {
  background: rgba(226, 87, 76, 0.35);
  border-color: rgba(226, 87, 76, 0.6);
}
.mini-meta {
  font-size: 0.66rem;
  opacity: 0.5;
  align-self: center;
  width: 100%;
  text-align: center;
}

/* 行内小唱片：当前曲目旋转 */
.tt-wrap {
  margin: 4px 0 18px;
}
.chart-hint {
  margin: 0 0 12px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid rgba(76, 194, 255, 0.25);
  background: rgba(76, 194, 255, 0.08);
  color: #8fd3ff;
  font-size: 0.8rem;
}
.track-list li .row-vinyl {
  flex: none;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, var(--accent, #4cc2ff) 0 26%, #0a0c0f 28% 100%);
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.35),
    inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}
.track-list li .row-vinyl.spin {
  animation: row-spin 3.6s linear infinite;
}
@keyframes row-spin {
  to {
    transform: rotate(360deg);
  }
}
.track-list li.playing .row-vinyl {
  box-shadow:
    0 0 0 2px color-mix(in oklab, var(--accent, #4cc2ff) 65%, transparent),
    0 2px 10px rgba(0, 0, 0, 0.4);
}
.track-list li .sel {
  display: flex;
  align-items: center;
  margin-right: 8px;
  cursor: pointer;
}
.track-list li .sel input {
  width: 18px;
  height: 18px;
  accent-color: var(--accent, #38bdf8);
  cursor: pointer;
}
</style>
