<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import { api } from '@/lib/api'
import { biliUrl, biliBase, biliUsingLocal, probeLocalBili, LOCAL_DOWN_HINT, setBiliBackend, resetBiliBackend, isLocalDevPage } from '@/lib/biliBackend'
import { fingerprint } from '@/lib/music'
import { addTrack, findTrackByHash } from '@/lib/db'
import { listAssets, uploadAsset } from '@/lib/cloud'
import { useAuthStore } from '@/stores/auth'
import AudioTrimmer from '@/components/AudioTrimmer.vue'
import BiliPlayer from '@/components/BiliPlayer.vue'

const auth = useAuthStore()

/** B站视频解析 / 下载 / 提取音频 / 剪切 */
interface PageInfo {
  cid: number
  page: number
  title: string
  duration: number
}
interface VideoInfo {
  bvid: string
  aid: number
  title: string
  cover: string
  duration: number
  owner: string
  desc: string
  pages: PageInfo[]
}
interface Quality {
  quality: number
  label: string
  width: number
  height: number
}
interface StreamItem {
  quality?: number
  label?: string
  width?: number
  height?: number
  codec?: string
  bandwidth?: number
  id?: number
  url: string
}
interface PlayInfo {
  qualities: Quality[]
  videos: StreamItem[]
  audios: StreamItem[]
  segments: { url: string; size: number }[]
}

const input = ref('')
/** 「一键粘贴」失败时用来把焦点送回输入框，用户可直接 Ctrl+V */
const inputEl = ref<HTMLInputElement | null>(null)
const loading = ref(false)

/** 最近解析过的链接（最多 10 条，存在 localStorage） */
interface RecentItem {
  url: string
  title: string
  bvid: string
  at: number
}
const recent = useStorage<RecentItem[]>('banyue:bili:recent', [])
const pasteTip = ref('')

function remember(url: string, info: VideoInfo): void {
  const item: RecentItem = { url, title: info.title.slice(0, 80), bvid: info.bvid, at: Date.now() }
  const rest = recent.value.filter((entry) => entry.url !== url)
  recent.value = [item, ...rest].slice(0, 10)
}

function clearRecent(): void {
  recent.value = []
}

/** 点历史记录：填回输入框并重新解析 */
async function openRecent(item: RecentItem): Promise<void> {
  input.value = item.url
  await resolve()
}

/**
 * 读剪贴板 → 自动解析。
 *
 * 注意：navigator.clipboard 只在 HTTPS 或 localhost 下可用。用 IP 走 HTTP
 * 打开时会直接被浏览器禁掉，所以这里给出更明确的提示，并自动聚焦输入框
 * 让用户直接 Ctrl+V —— 手动粘贴一样能用，只是少了这一步自动化。
 */
async function pasteAndResolve(): Promise<void> {
  pasteTip.value = ''
  const secure = window.isSecureContext
  if (!secure || !navigator.clipboard?.readText) {
    pasteTip.value = '当前是 HTTP 访问，浏览器不允许读剪贴板。请点输入框后按 Ctrl+V 粘贴'
    inputEl.value?.focus()
    setTimeout(() => (pasteTip.value = ''), 6000)
    return
  }
  try {
    const text = await navigator.clipboard.readText()
    const value = text.trim()
    if (!value) {
      pasteTip.value = '剪贴板是空的'
      return
    }
    input.value = value
    await resolve()
  } catch {
    pasteTip.value = '读剪贴板被拒绝，请手动粘贴（Ctrl+V）'
    inputEl.value?.focus()
    setTimeout(() => (pasteTip.value = ''), 4000)
  }
}
const error = ref('')

/** 手动切到本机后端（服务器解析被风控时的备用通道） */
function useLocalBili(): void {
  setBiliBackend('http://127.0.0.1:8787')
  error.value = ''
}

/** 切回默认：由服务器解析 */
function useServerBili(): void {
  resetBiliBackend()
  error.value = ''
}
const video = ref<VideoInfo | null>(null)
const pageIndex = ref(0)
const play = ref<PlayInfo | null>(null)
const playLoading = ref(false)
const quality = ref<number | null>(null)
const audioIndex = ref(0)
const extracting = ref(false)
const trimSrc = ref('')
const trimTitle = ref('')
const trimKey = ref(0)
const useCover = ref(true)
const savingLocal = ref(false)
const savingCloud = ref(false)
const saveMessage = ref('')
const saveError = ref('')

function flash(text: string, isError = false): void {
  if (isError) {
    saveError.value = text
    saveMessage.value = ''
  } else {
    saveMessage.value = text
    saveError.value = ''
  }
  setTimeout(() => {
    saveMessage.value = ''
    saveError.value = ''
  }, 5000)
}

const currentPage = computed<PageInfo | null>(() => video.value?.pages[pageIndex.value] ?? null)

function proxyUrl(raw: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ url: raw, ...extra })
  return biliUrl(`/api/bilibili/stream?${params.toString()}`)
}

function fmtDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

async function resolve(): Promise<void> {
  const url = input.value.trim()
  if (!url) return
  loading.value = true
  error.value = ''
  video.value = null
  play.value = null
  trimSrc.value = ''
  try {
    // 跨域借用本机后端时，先确认它真的开着——否则报错只会是一句
    // 「网络不通」，用户根本不知道要自己去启动服务。
    if (biliUsingLocal() && !(await probeLocalBili())) {
      throw new Error(LOCAL_DOWN_HINT)
    }
    video.value = await api<VideoInfo>(biliUrl('/api/bilibili/resolve'), { method: 'POST', body: { url } })
    remember(url, video.value)
    pageIndex.value = 0
    await loadPlay()
  } catch (err) {
    const message = (err as Error).message
    // 探活之后才知道服务挂了（比如中途被关掉），同样给准信儿
    error.value =
      biliUsingLocal() && /网络不通|Failed to fetch/i.test(message)
        ? LOCAL_DOWN_HINT
        : message
  } finally {
    loading.value = false
  }
}

async function loadPlay(): Promise<void> {
  const info = video.value
  const page = currentPage.value
  if (!info || !page) return
  playLoading.value = true
  error.value = ''
  play.value = null
  trimSrc.value = ''
  audioCache.value = null
  try {
    const data = await api<PlayInfo>(biliUrl(`/api/bilibili/playinfo?aid=${info.aid}&cid=${page.cid}`))
    play.value = data
    quality.value = data.qualities[0]?.quality ?? data.videos[0]?.quality ?? null
    audioIndex.value = 0
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    playLoading.value = false
  }
}

async function pickPage(index: number): Promise<void> {
  pageIndex.value = index
  audioCache.value = null
  await loadPlay()
}

const selectedVideo = computed<StreamItem | null>(() => {
  const info = play.value
  if (!info) return null
  const sameQuality = info.videos.filter((item) => item.quality === quality.value)
  // 优先 avc（兼容性最好），其次第一个
  return sameQuality.find((item) => item.codec === 'avc') ?? sameQuality[0] ?? info.videos[0] ?? null
})

const selectedAudio = computed<StreamItem | null>(() => play.value?.audios[audioIndex.value] ?? null)

// 换了音轨就作废缓存，避免拿旧文件的字节去保存
watch(audioIndex, () => {
  audioCache.value = null
})

/* 在线播放：视频用 avc 流 + 音频流双流同步 */
const showPlayer = ref(false)
const playerMode = ref<'video' | 'audio'>('video')
const streamVideoUrl = computed(() => (selectedVideo.value ? proxyUrl(selectedVideo.value.url) : ''))
const streamAudioUrl = computed(() => (selectedAudio.value ? proxyUrl(selectedAudio.value.url) : ''))

function openPlayer(mode: 'video' | 'audio'): void {
  playerMode.value = mode
  showPlayer.value = true
}

/** 视频下载：交给浏览器走代理附件下载（流式，不占内存） */
const videoDownloadUrl = computed(() => {
  const item = selectedVideo.value
  const info = video.value
  if (!item || !info) return ''
  return proxyUrl(item.url, {
    download: '1',
    title: `${info.title}-${currentPage.value?.title ?? ''}`.slice(0, 80),
    ext: '.mp4',
  })
})

/** 音频下载：直接存 m4a */
const audioDownloadUrl = computed(() => {
  const item = selectedAudio.value
  const info = video.value
  if (!item || !info) return ''
  return proxyUrl(item.url, {
    download: '1',
    title: `${info.title}-${currentPage.value?.title ?? ''}`.slice(0, 80),
    ext: '.m4a',
  })
})

/** 提取音频到剪辑器：用代理地址喂给 Web Audio 解码 */
function extractAudio(): void {
  const item = selectedAudio.value
  const info = video.value
  if (!item || !info) return
  extracting.value = true
  trimTitle.value = `${info.title}-${currentPage.value?.title ?? ''}`.slice(0, 60)
  trimSrc.value = proxyUrl(item.url)
  trimKey.value += 1
  setTimeout(() => (extracting.value = false), 300)
}

/** 带超时的 fetch：B站 CDN 偶发「连上但一直不返回」，没超时会永久卡在保存中 */
async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 分段拉取整段音频（B站 CDN 单连接易断，按 2MB 分块 + 重试）。
 * 每一步都有超时，探测拿不到总长就退化成整段下载——绝不让保存永久卡住。
 */
async function fetchAudioBlob(url: string): Promise<Blob> {
  const PROBE_MS = 8000      // 探测总长
  const CHUNK_MS = 15000     // 单个分块
  const FULL_MS = 60000      // 整段兜底

  // 探测总长：先用 1KB 的 Range，只为了拿 content-range 里的总长度
  let total = 0
  for (let attempt = 0; attempt < 3 && !total; attempt++) {
    try {
      const response = await fetchWithTimeout(url, { headers: { range: 'bytes=0-1023' } }, PROBE_MS)
      if (response.ok) {
        total = Number(/bytes \d+-\d+\/(\d+)/.exec(response.headers.get('content-range') ?? '')?.[1] ?? 0)
        // 释放探测的响应体，别把连接挂着
        await response.arrayBuffer().catch(() => undefined)
      }
    } catch {
      /* 超时/失败：下一轮重试 */
    }
    if (!total) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
  }

  // 拿不到总长或音频很小：直接整段下（实测 5MB 只要几百毫秒，比逐块更快）
  if (!total || total < 2 << 20) {
    const full = await fetchWithTimeout(url, {}, FULL_MS)
    if (!full.ok) throw new Error(`读取音频失败（${full.status}）`)
    return full.blob()
  }

  const chunkSize = 2 << 20
  const parts: Uint8Array[] = []
  for (let start = 0; start < total; start += chunkSize) {
    const end = Math.min(total - 1, start + chunkSize - 1)
    let done = false
    for (let attempt = 0; attempt < 3 && !done; attempt++) {
      try {
        const response = await fetchWithTimeout(url, { headers: { range: `bytes=${start}-${end}` } }, CHUNK_MS)
        if (response.status === 206 || response.status === 200) {
          const buffer = await response.arrayBuffer()
          if (buffer.byteLength > 0) {
            parts.push(new Uint8Array(buffer))
            done = true
          }
        }
      } catch {
        /* 重试 */
      }
      if (!done && attempt < 2) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)))
    }
    if (!done) throw new Error('音频下载中断，链接可能过期，重新解析一次')
  }
  return new Blob(parts as BlobPart[], { type: 'audio/mp4' })
}

/** 已下载的音频缓存：保存到本地/云端共用，避免同一个文件重复下载两遍 */
const audioCache = ref<{ key: string; blob: Blob } | null>(null)

/** 下载整段音频；失败了自动重新解析一次（B站 链接会过期 / 节点会抖） */
async function fetchAudioWithRefresh(): Promise<Blob> {
  const item = selectedAudio.value
  if (!item) throw new Error('没有可用的音轨')
  // 同一条音轨 + 同一标题，直接复用上次下载的，第二个按钮就能秒开
  const key = `${item.url}|${trackName.value}`
  if (audioCache.value?.key === key) return audioCache.value.blob
  let blob: Blob
  try {
    blob = await fetchAudioBlob(proxyUrl(item.url))
  } catch {
    // 链接过期或节点失联：重新取一次 playurl 再试
    await loadPlay()
    const fresh = selectedAudio.value
    if (!fresh) throw new Error('音频链接已失效，重新解析一次视频')
    blob = await fetchAudioBlob(proxyUrl(fresh.url))
  }
  audioCache.value = { key, blob }
  return blob
}

/** 把视频封面压成小图 dataURL（240px，约 30KB），用于唱片封面 */
async function compressCover(url: string): Promise<string> {
  try {
    // 封面挂起不该拖垮整个保存：8 秒拿不到就跳过封面
    const response = await fetchWithTimeout(url, {}, 8000)
    if (!response.ok) return ''
    const blob = await response.blob()
    const bitmap = await createImageBitmap(blob)
    const size = 240
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return ''
    // 居中裁成正方形
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
    bitmap.close?.()
    return canvas.toDataURL('image/jpeg', 0.8)
  } catch {
    return ''
  }
}

/** 当前选择是否带封面（勾选了才去压图） */
async function currentCover(): Promise<string> {
  if (!useCover.value) return ''
  const info = video.value
  if (!info?.cover) return ''
  return compressCover(biliUrl(`/api/bilibili/cover?url=${encodeURIComponent(info.cover)}`))
}

/** 音频的标题与艺人（分P 时用「标题 - 分P」） */
const trackName = computed(() => {
  const info = video.value
  if (!info) return 'bilibili'
  const page = currentPage.value
  const chunk = page && info.pages.length > 1 ? `${info.title} - ${page.title}` : info.title
  return chunk.trim().slice(0, 80)
})

/** 保存阶段提示：让用户知道在下载而不是卡死 */
const savePhase = ref('')

/** 保存到本地音乐库（IndexedDB，按指纹判重） */
async function saveToLocal(): Promise<void> {
  const item = selectedAudio.value
  if (!item || savingLocal.value) return
  saveMessage.value = ''
  saveError.value = ''
  savingLocal.value = true
  savePhase.value = '正在下载音频…'
  try {
    const blob = await fetchAudioWithRefresh()
    const buffer = await blob.arrayBuffer()
    savePhase.value = '正在处理封面…'
    const cover = await currentCover()
    savePhase.value = '正在写入本地音乐库…'
    const hash = await fingerprint(buffer, `${trackName.value}-${blob.size}`)
    const existing = await findTrackByHash(hash)
    if (existing) {
      // 之前没封面、这次勾选了就补上，不重复占空间
      if (cover && !existing.cover) await addTrack({ ...existing, cover })
      flash(cover && !existing.cover ? '本地已有这首，已补上封面' : '本地音乐里已有这首，跳过')
      return
    }
    await addTrack({
      id: hash,
      title: trackName.value,
      artist: video.value?.owner ?? '',
      size: blob.size,
      hash,
      createdAt: Date.now(),
      data: blob,
      cover,
    })
    flash(`已保存到本地音乐：《${trackName.value}》${cover ? '（含封面）' : ''}`)
  } catch (err) {
    flash((err as Error).message || '保存到本地失败', true)
  } finally {
    savingLocal.value = false
    savePhase.value = ''
  }
}

/** 保存到云端音乐库（需要登录，服务端也按指纹判重） */
async function saveToCloud(): Promise<void> {
  const item = selectedAudio.value
  if (!item || savingCloud.value) return
  if (!auth.loggedIn) {
    auth.openDialog()
    return
  }
  saveMessage.value = ''
  saveError.value = ''
  savingCloud.value = true
  savePhase.value = '正在下载音频…'
  try {
    const blob = await fetchAudioWithRefresh()
    const buffer = await blob.arrayBuffer()
    savePhase.value = '正在检查云端是否已有…'
    const hash = await fingerprint(buffer, `${trackName.value}-${blob.size}`)
    // 云端已有同指纹：只补封面（不重复传 5MB 音频）
    try {
      const existing = await listAssets('track')
      const same = existing.find((asset) => asset.hash && asset.hash === hash)
      if (same) {
        savePhase.value = '正在处理封面…'
        const cover = await currentCover()
        if (cover && !same.cover) {
          await api(`/api/assets/${encodeURIComponent(same.id)}/cover`, { method: 'POST', body: { cover } })
          flash('云端已有这首，已补上封面')
        } else {
          flash('云端已有这首，跳过')
        }
        return
      }
    } catch {
      /* 查不到就让服务端判重 */
    }
    savePhase.value = '正在处理封面…'
    const cover = await currentCover()
    savePhase.value = `正在上传（${(blob.size / 1048576).toFixed(1)}MB）…`
    const result = await uploadAsset('track', blob, {
      title: trackName.value,
      subtitle: video.value?.owner ?? '',
      filename: `${trackName.value}.m4a`,
      hash,
      cover,
    })
    flash(result.duplicate ? '云端已有这首，跳过' : `已上传到云端：《${trackName.value}》`)
  } catch (err) {
    flash((err as Error).message || '保存到云端失败', true)
  } finally {
    savingCloud.value = false
    savePhase.value = ''
  }
}
</script>

<template>
  <div class="shell">
    <div class="page-head">
      <span class="eyebrow">Tools · 视频与音频</span>
      <h1>B站下载与音频剪辑</h1>
      <p>
        粘贴 B站 视频链接，选清晰度下载；也可以只提取音频，在波形上剪出想要的片段导出 WAV。
        仅限个人学习使用，请尊重原作者版权。
      </p>
      <p v-if="biliUsingLocal()" class="notice small">
        解析走本机后端（{{ biliBase() }}）。本机后端没开的话会失败——先在本地跑
        <code>cd server &amp;&amp; node src/index.mjs</code>，或
        <button type="button" class="link-btn" @click="useServerBili">恢复默认（用服务器解析）</button>
      </p>
      <p v-else class="muted small">
        服务器解析不给力？
        <button type="button" class="link-btn" @click="useLocalBili">改用本机后端解析</button>
        <span v-if="isLocalDevPage()">（本地开发时无需切换）</span>
      </p>
    </div>

    <form class="search-row" @submit.prevent="resolve">
      <input
        ref="inputEl"
        v-model="input"
        type="text"
        placeholder="粘贴链接，如 https://www.bilibili.com/video/BV1xx411c7mD"
        aria-label="B站视频链接"
      />
      <button type="button" class="btn" :disabled="loading" title="读剪贴板并直接解析" @click="pasteAndResolve">
        一键粘贴
      </button>
      <button type="submit" class="btn primary" :disabled="loading">{{ loading ? '解析中…' : '解析' }}</button>
    </form>
    <p v-if="pasteTip" class="notice">{{ pasteTip }}</p>

    <!-- 最近解析 -->
    <section v-if="recent.length" class="recent">
      <div class="recent-head">
        <span class="muted small">最近解析（{{ recent.length }}/10）</span>
        <button type="button" class="mini" @click="clearRecent">清空</button>
      </div>
      <ul>
        <li v-for="item in recent" :key="item.url">
          <button type="button" class="recent-item" :title="item.url" @click="openRecent(item)">
            <b>{{ item.title }}</b>
            <span>{{ item.bvid }} · {{ new Date(item.at).toLocaleDateString() }}</span>
          </button>
        </li>
      </ul>
    </section>

    <p v-if="error" class="notice bili-error">{{ error }}</p>
    <p v-if="loading" class="muted small">正在向 B站 请求视频信息…</p>

    <!-- 视频信息 -->
    <section v-if="video" class="video-card">
      <img class="cover" :src="biliUrl(`/api/bilibili/cover?url=${encodeURIComponent(video.cover)}`)" alt="" loading="lazy" />
      <div class="meta">
        <h2>{{ video.title }}</h2>
        <p class="muted small">
          {{ video.owner }} · {{ fmtDuration(video.duration) }} · {{ video.bvid }}
        </p>
        <p v-if="video.desc" class="desc">{{ video.desc }}</p>

        <div v-if="video.pages.length > 1" class="pages">
          <span class="muted small">分P：</span>
          <button
            v-for="(page, index) in video.pages"
            :key="page.cid"
            type="button"
            class="chip small"
            :class="{ on: index === pageIndex }"
            @click="pickPage(index)"
          >
            P{{ page.page }}
          </button>
        </div>
      </div>
    </section>

    <!-- 下载与音频 -->
    <section v-if="video" class="panel">
      <p v-if="playLoading" class="muted small">正在取播放地址…</p>

      <template v-else-if="play">
        <div class="block">
          <h3>下载视频</h3>
          <p class="muted small">
            共 {{ play.qualities.length }} 种清晰度<template v-if="play.qualities.length === 1">（未登录 B站 通常只有 480P/360P，配置 SESSDATA 可解锁高清）</template>：
          </p>
          <div class="chips">
            <button
              v-for="item in play.qualities"
              :key="item.quality"
              type="button"
              class="chip small"
              :class="{ on: quality === item.quality }"
              @click="quality = item.quality"
            >
              {{ item.label }} · {{ item.width }}×{{ item.height }}
            </button>
          </div>
          <div class="row">
            <a
              v-if="videoDownloadUrl"
              class="btn primary"
              :href="videoDownloadUrl"
              :download="`${video.title}.mp4`"
            >
              下载视频（{{ selectedVideo?.codec?.toUpperCase() }}）
            </a>
            <button
              type="button"
              class="btn"
              :disabled="!streamVideoUrl || !streamAudioUrl"
              title="不下载，直接在页面上看"
              @click="openPlayer('video')"
            >
              在线观看
            </button>
            <span v-if="selectedVideo?.bandwidth" class="muted small">
              约 {{ Math.round((selectedVideo.bandwidth * 8) / 1000 / 1000 * 10) / 10 }} Mbps
            </span>
          </div>
        </div>

        <div class="block">
          <h3>提取音频</h3>
          <p class="muted small">选一条音轨，可以直接下载 m4a，或送进下面的剪辑器剪出片段。</p>
          <div class="chips">
            <button
              v-for="(item, index) in play.audios"
              :key="item.id ?? index"
              type="button"
              class="chip small"
              :class="{ on: audioIndex === index }"
              @click="audioIndex = index"
            >
              {{ Math.round((item.bandwidth ?? 0) / 1000) }}kbps {{ item.codec?.includes('mp4a') ? 'AAC' : '' }}
            </button>
          </div>
          <div class="row">
            <a v-if="audioDownloadUrl" class="btn" :href="audioDownloadUrl" :download="`${video.title}.m4a`">
              下载音频 m4a
            </a>
            <button type="button" class="btn primary" :disabled="!selectedAudio || extracting" @click="extractAudio">
              {{ extracting ? '准备中…' : '提取到剪辑器' }}
            </button>
            <button
              type="button"
              class="btn"
              :disabled="!streamAudioUrl"
              title="不下载，直接试听这段音频"
              @click="openPlayer('audio')"
            >
              在线试听
            </button>
            <button
              type="button"
              class="btn"
              :disabled="!selectedAudio || savingLocal"
              title="存进浏览器本地音乐库，可在「听歌 → 本地音乐」里播放"
              @click="saveToLocal"
            >
              {{ savingLocal ? (savePhase || '保存中…') : '保存到本地音乐' }}
            </button>
            <button
              type="button"
              class="btn"
              :disabled="!selectedAudio || savingCloud"
              title="上传到云端音乐库，登录后所有人可听"
              @click="saveToCloud"
            >
              {{ savingCloud ? (savePhase || '上传中…') : '保存到云端音乐' }}
            </button>
          </div>
          <label class="cover-check">
            <input v-model="useCover" type="checkbox" />
            用视频封面作为唱片封面
            <img
              v-if="useCover && video"
              class="cover-preview"
              loading="lazy"
              :src="biliUrl(`/api/bilibili/cover?url=${encodeURIComponent(video.cover)}`)"
              alt=""
            />
          </label>
          <p v-if="saveMessage" class="save-msg">{{ saveMessage }}</p>
          <p v-if="saveError" class="save-err">{{ saveError }}</p>
          <p v-if="!auth.loggedIn" class="muted small">保存到云端需要先登录（右上角「登录」）。</p>
        </div>
      </template>
    </section>

    <!-- 在线播放 -->
    <section v-if="showPlayer && streamAudioUrl" class="panel">
      <div class="player-head">
        <h3>{{ playerMode === 'video' ? '在线观看' : '在线试听' }}</h3>
        <button type="button" class="btn small-btn" @click="showPlayer = false">收起</button>
      </div>
      <BiliPlayer
        :key="`${streamVideoUrl}|${streamAudioUrl}`"
        :video-url="streamVideoUrl"
        :audio-url="streamAudioUrl"
        :poster="video ? biliUrl(`/api/bilibili/cover?url=${encodeURIComponent(video.cover)}`) : ''"
        :title="video?.title"
        :audio-only="playerMode === 'audio'"
      />
    </section>

    <!-- 剪辑器 -->
    <section v-if="trimSrc" class="panel">
      <h3>音频剪辑：{{ trimTitle }}</h3>
      <AudioTrimmer :key="trimKey" :src="trimSrc" :title="trimTitle" />
    </section>
  </div>
</template>

<style scoped>
.search-row {
  display: flex;
  gap: 10px;
  margin: 6px 0 18px;
}
.search-row input {
  flex: 1;
  min-height: 44px;
  padding: 10px 16px;
  border-radius: var(--radius-sm, 10px);
  border: 1px solid var(--line-strong);
  background: var(--card);
  color: var(--text);
  font-size: 0.95rem;
  outline: none;
}
.search-row input:focus {
  border-color: #4cc2ff;
}
.btn.primary {
  background: #4cc2ff;
  border-color: transparent;
  color: #06222e;
  font-weight: 600;
}

/* 最近解析 */
.recent {
  margin: 0 0 18px;
}
.recent-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.recent ul {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}
.recent-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--card);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: 0.15s ease;
}
.recent-item:hover {
  border-color: rgba(124, 196, 255, 0.5);
  transform: translateY(-1px);
}
.recent-item b {
  font-size: 0.84rem;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.recent-item span {
  font-size: 0.72rem;
  opacity: 0.6;
}

.video-card {
  display: flex;
  gap: 16px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
}
.cover {
  width: 220px;
  height: 124px;
  object-fit: cover;
  border-radius: 10px;
  flex: none;
  background: #0d1319;
}
.meta {
  min-width: 0;
}
.meta h2 {
  margin: 0 0 6px;
  font-size: 1.05rem;
  line-height: 1.4;
}
.desc {
  margin: 6px 0 0;
  font-size: 0.8rem;
  opacity: 0.7;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pages {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.panel {
  margin-top: 18px;
  padding: 16px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--card);
}
.block + .block {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--line);
}
.block h3,
.panel > h3 {
  margin: 0 0 8px;
  font-size: 0.95rem;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}
.chip.small {
  padding: 5px 12px;
  font-size: 0.78rem;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-top: 10px;
}
.btn.primary {
  background: #4cc2ff;
  border-color: transparent;
  color: #06222e;
  font-weight: 600;
}
a.btn {
  display: inline-block;
  text-decoration: none;
}
.save-msg {
  margin: 10px 0 0;
  color: #58d68d;
  font-size: 0.82rem;
}
.save-err {
  margin: 10px 0 0;
  color: #ff7b72;
  font-size: 0.82rem;
}
.cover-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  font-size: 0.82rem;
  opacity: 0.9;
  cursor: pointer;
}
.cover-check input {
  width: 16px;
  height: 16px;
  accent-color: #4cc2ff;
  cursor: pointer;
}
.cover-preview {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid var(--line-strong);
}

@media (max-width: 700px) {
  .video-card {
    flex-direction: column;
  }
  .cover {
    width: 100%;
    height: 180px;
  }
}

/* 「本机后端没开」这类提示是带换行和命令的，保留排版 */
.bili-error {
  white-space: pre-line;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  line-height: 1.6;
}

.link-btn {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent, #4cc2ff);
  text-decoration: underline;
  cursor: pointer;
  font: inherit;
}
</style>
