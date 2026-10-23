<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { useAuthStore } from '@/stores/auth'
import { REGIONS, fetchTopSongs, fingerprint, formatTime, isAudioFile, searchSongs, type Region, type Track } from '@/lib/music'
import { addTrack, deleteTrack, findTrackByHash, getTrackBlob, listTracks, type TrackRecord } from '@/lib/db'
import { assetUrl, deleteAsset, formatSize, getStorage, listAssets, syncTracksToCloud, uploadAsset, type CloudAsset, type StorageUsage } from '@/lib/cloud'
import { BILI_HOT, BILI_SNAP } from '@/lib/bili'
import { formatCount } from '@/lib/format'
import BatchBar from '@/components/BatchBar.vue'
import Turntable from '@/components/Turntable.vue'

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
function isSelected(id: string): boolean {
  return selected.value.includes(id)
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
  try {
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
  } finally {
    // 中途抛错也要把按钮解锁，否则会一直显示「导入中…」
    importing.value = false
  }
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

/** 行点击：批量模式下选中；平时「把唱片放到唱片机」开播（按钮/勾选框除外） */
function onRowClick(event: MouseEvent, list: Track[], index: number, id: string): void {
  if ((event.target as HTMLElement).closest('button, label, input, a')) return
  if (selectMode.value) {
    toggleSelect(id)
    return
  }
  void playFrom(list, index)
}

/** 云端行点击：批量模式下只允许勾可删项（自己的或管理员） */
function onCloudRowClick(event: MouseEvent, index: number): void {
  if ((event.target as HTMLElement).closest('button, label, input, a')) return
  const asset = cloudTracks.value[index]
  if (selectMode.value) {
    if (cloudDeletable(asset)) toggleSelect(asset?.id ?? '')
    return
  }
  void playFrom(cloudList.value, index)
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
      <p>榜单来自 Apple Music 公开接口，试听 30 秒；点列表里任意一张唱片就放上唱片机开播。</p>
    </div>

    <Turntable class="tt-wrap" />

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
          @click="onRowClick($event, charts, index, track.id)"
        >
          <span class="row-vinyl" :class="{ spin: isCurrent(track) && player.playing }" aria-hidden="true" />
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
          @click="onRowClick($event, results, index, track.id)"
        >
          <span class="row-vinyl" :class="{ spin: isCurrent(track) && player.playing }" aria-hidden="true" />
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
        <button
          v-if="localTracks.length"
          type="button"
          class="btn small-btn"
          :class="{ on: selectMode }"
          @click="selectMode ? exitSelectMode() : enterSelectMode()"
        >
          {{ selectMode ? '完成' : '批量管理' }}
        </button>
        <span class="muted small">支持 mp3 / m4a / flac / wav / ogg，按内容指纹去重</span>
      </div>
      <p v-if="message" class="notice">{{ message }}</p>
      <p v-if="cloudError" class="notice">{{ cloudError }}</p>
      <p class="muted small">本地共 {{ local.length }} 首，存在浏览器 IndexedDB 里。</p>

      <ol v-if="localTracks.length" class="track-list">
        <li
          v-for="(track, index) in localTracks"
          :key="track.id"
          :class="{ playing: isCurrent(track), selected: selectMode && isSelected(track.id) }"
          :title="selectMode ? '点击选中' : '双击播放 / 暂停'"
          @click="onRowClick($event, localTracks, index, track.id)"
          @dblclick="!selectMode && player.toggleAt(localTracks, index)"
        >
          <label v-if="selectMode" class="sel" @click.stop>
            <input type="checkbox" :checked="isSelected(track.id)" @change="toggleSelect(track.id)" />
          </label>
          <span class="row-vinyl" :class="{ spin: isCurrent(track) && player.playing }" aria-hidden="true" />
          <div class="t-main">
            <b>{{ track.title }}</b>
            <span>{{ track.artist }} · #{{ track.hash?.slice(0, 6) }}</span>
          </div>
          <template v-if="!selectMode">
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
          </template>
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
      <ol v-else-if="cloudList.length" class="track-list">
        <li
          v-for="(track, index) in cloudList"
          :key="track.id"
          :class="{
            playing: isCurrent(track),
            selected: selectMode && isSelected(cloudTracks[index]?.id ?? ''),
          }"
          :title="selectMode && cloudDeletable(cloudTracks[index]) ? '点击选中' : '双击播放 / 暂停'"
          @click="onCloudRowClick($event, index)"
          @dblclick="!selectMode && player.toggleAt(cloudList, index)"
        >
          <label v-if="selectMode && cloudDeletable(cloudTracks[index])" class="sel" @click.stop>
            <input
              type="checkbox"
              :checked="isSelected(cloudTracks[index]?.id ?? '')"
              @change="toggleSelect(cloudTracks[index]!.id)"
            />
          </label>
          <span class="row-vinyl" :class="{ spin: isCurrent(track) && player.playing }" aria-hidden="true" />
          <div class="t-main">
            <b>{{ track.title }}</b>
            <span>{{ cloudTracks[index]?.owner.displayName }} · {{ formatSize(cloudTracks[index]?.size ?? 0) }}</span>
          </div>
          <template v-if="!selectMode">
            <button type="button" class="play" @click="playFrom(cloudList, index)">
              {{ isCurrent(track) && player.playing ? '暂停' : '播放' }}
            </button>
            <button
              type="button"
              class="cloud-btn"
              :disabled="cloudBusy === cloudTracks[index]?.id"
              title="下载到本地（本地已有同文件会跳过）"
              @click="cloudTracks[index] && downloadToLocal(cloudTracks[index]!)"
            >
              {{ cloudBusy === cloudTracks[index]?.id ? '下载中…' : '下载' }}
            </button>
            <button
              v-if="cloudDeletable(cloudTracks[index])"
              type="button"
              class="del"
              @click="removeCloud(cloudTracks[index]!)"
            >
              删除
            </button>
          </template>
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
          @click="onRowClick($event, player.favorites, index, track.id)"
        >
          <span class="row-vinyl" :class="{ spin: isCurrent(track) && player.playing }" aria-hidden="true" />
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

.douyin-links {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}

/* 批量管理选中态 */
.track-list li.selected {
  background: color-mix(in oklab, var(--accent, #38bdf8) 12%, transparent);
}

/* 行内小唱片：当前曲目旋转 */
.tt-wrap {
  margin: 4px 0 18px;
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
