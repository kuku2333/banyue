<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '@/lib/api'
import AudioTrimmer from '@/components/AudioTrimmer.vue'

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
const loading = ref(false)
const error = ref('')
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

const currentPage = computed<PageInfo | null>(() => video.value?.pages[pageIndex.value] ?? null)

function proxyUrl(raw: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ url: raw, ...extra })
  return `/api/bilibili/stream?${params.toString()}`
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
    video.value = await api<VideoInfo>('/api/bilibili/resolve', { method: 'POST', body: { url } })
    pageIndex.value = 0
    await loadPlay()
  } catch (err) {
    error.value = (err as Error).message
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
  try {
    const data = await api<PlayInfo>(`/api/bilibili/playinfo?aid=${info.aid}&cid=${page.cid}`)
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
    </div>

    <form class="search-row" @submit.prevent="resolve">
      <input
        v-model="input"
        type="text"
        placeholder="粘贴链接，如 https://www.bilibili.com/video/BV1xx411c7mD"
        aria-label="B站视频链接"
      />
      <button type="submit" class="btn" :disabled="loading">{{ loading ? '解析中…' : '解析' }}</button>
    </form>

    <p v-if="error" class="notice">{{ error }}</p>
    <p v-if="loading" class="muted small">正在向 B站 请求视频信息…</p>

    <!-- 视频信息 -->
    <section v-if="video" class="video-card">
      <img class="cover" :src="`/api/bilibili/cover?url=${encodeURIComponent(video.cover)}`" alt="" loading="lazy" />
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
          </div>
        </div>
      </template>
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

@media (max-width: 700px) {
  .video-card {
    flex-direction: column;
  }
  .cover {
    width: 100%;
    height: 180px;
  }
}
</style>
