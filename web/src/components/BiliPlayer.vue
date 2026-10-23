<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

/**
 * B站 dash 在线播放：视频流和音频流是分开的，用 video(muted) + audio 同步播放。
 * 浏览器不支持 HEVC，所以 videoUrl 必须是 avc/h264 那条。
 */
const props = defineProps<{
  videoUrl: string
  audioUrl: string
  poster?: string
  title?: string
  /** 只有音频时也给个试听模式 */
  audioOnly?: boolean
}>()

const videoEl = ref<HTMLVideoElement | null>(null)
const audioEl = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const muted = ref(false)
const loading = ref(false)
const error = ref('')
const currentTime = ref(0)
const duration = ref(0)

const hasVideo = computed(() => !props.audioOnly)

function syncFromAudio(): void {
  const audio = audioEl.value
  const video = videoEl.value
  if (!audio) return
  currentTime.value = audio.currentTime
  if (audio.duration && Number.isFinite(audio.duration)) duration.value = audio.duration
  // 视频追音频；偏差超过 0.35s 才硬纠正，避免抖动
  if (video && Number.isFinite(audio.currentTime) && Math.abs(video.currentTime - audio.currentTime) > 0.35) {
    try {
      video.currentTime = audio.currentTime
    } catch {
      /* 元数据还没就绪 */
    }
  }
}

async function play(): Promise<void> {
  const audio = audioEl.value
  const video = videoEl.value
  if (!audio) return
  loading.value = true
  error.value = ''
  try {
    if (video) {
      video.muted = muted.value
      await video.play().catch(() => undefined)
    }
    await audio.play()
    playing.value = true
  } catch (err) {
    error.value = (err as Error).message || '浏览器无法播放这段流'
    playing.value = false
  } finally {
    loading.value = false
  }
}

function pause(): void {
  videoEl.value?.pause()
  audioEl.value?.pause()
  playing.value = false
}

function toggle(): void {
  if (playing.value) pause()
  else void play()
}

function toggleMute(): void {
  muted.value = !muted.value
  if (videoEl.value) videoEl.value.muted = muted.value
  if (audioEl.value) audioEl.value.muted = muted.value
}

function seek(event: MouseEvent): void {
  const el = event.currentTarget as HTMLElement
  const ratio = Math.min(1, Math.max(0, (event.clientX - el.getBoundingClientRect().left) / el.getBoundingClientRect().width))
  const audio = audioEl.value
  if (!audio || !duration.value) return
  audio.currentTime = ratio * duration.value
  if (videoEl.value) {
    try {
      videoEl.value.currentTime = ratio * duration.value
    } catch {
      /* ignore */
    }
  }
}

function onMeta(event: Event): void {
  const el = event.target as HTMLVideoElement | HTMLAudioElement | null
  const value = el?.duration
  if (Number.isFinite(value) && value) duration.value = value
}

function fmt(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

watch(
  () => [props.videoUrl, props.audioUrl],
  () => {
    pause()
    currentTime.value = 0
    duration.value = 0
  },
)

onBeforeUnmount(() => {
  pause()
})
</script>

<template>
  <div class="bili-player">
    <div class="stage">
      <video
        v-if="hasVideo"
        ref="videoEl"
        class="screen"
        :poster="props.poster"
        :src="props.videoUrl"
        playsinline
        preload="metadata"
        @loadedmetadata="onMeta"
        @click="toggle"
      />
      <div v-else class="audio-stage">
        <div class="audio-disc" :class="{ spin: playing }">♪</div>
        <p class="muted small">{{ props.title || '音频试听' }}</p>
      </div>

      <button v-if="!playing" type="button" class="big-play" :disabled="loading" @click="play">
        {{ loading ? '…' : '▶' }}
      </button>
    </div>

    <audio
      ref="audioEl"
      :src="props.audioUrl"
      preload="metadata"
      @timeupdate="syncFromAudio"
      @loadedmetadata="onMeta"
      @ended="pause"
    />

    <div class="controls">
      <button type="button" class="btn" :disabled="loading" @click="toggle">
        {{ playing ? '暂停' : '播放' }}
      </button>
      <button type="button" class="btn" @click="toggleMute">{{ muted ? '取消静音' : '静音' }}</button>
      <div class="progress" @click="seek">
        <i :style="{ width: duration ? `${Math.round((currentTime / duration) * 100)}%` : '0%' }" />
      </div>
      <span class="time">{{ fmt(currentTime) }} / {{ fmt(duration) }}</span>
    </div>

    <p v-if="error" class="err">{{ error }}</p>
    <p class="muted small">
      在线播放走本站代理；视频与音频是两条流同步播放，卡顿时可以先暂停缓冲。
      <template v-if="hasVideo">（浏览器不支持 HEVC，这里固定用 AVC 版本视频 + AAC 音频）</template>
    </p>
  </div>
</template>

<style scoped>
.bili-player {
  margin-top: 12px;
}
.stage {
  position: relative;
  border-radius: 12px;
  overflow: hidden;
  background: #05080c;
  border: 1px solid var(--line);
}
.screen {
  display: block;
  width: 100%;
  max-height: 62vh;
  background: #05080c;
  cursor: pointer;
}
.audio-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 180px;
}
.audio-disc {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  font-size: 1.6rem;
  color: rgba(255, 255, 255, 0.9);
  background: radial-gradient(circle at 50% 50%, #4cc2ff 0 24%, #0a0d10 26% 100%);
}
.audio-disc.spin {
  animation: bp-spin 3.6s linear infinite;
}
@keyframes bp-spin {
  to {
    transform: rotate(360deg);
  }
}
.big-play {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 64px;
  height: 64px;
  border-radius: 50%;
  border: none;
  background: rgba(76, 194, 255, 0.92);
  color: #06222e;
  font-size: 1.4rem;
  cursor: pointer;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.controls {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
  flex-wrap: wrap;
}
.progress {
  flex: 1;
  min-width: 120px;
  height: 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
  overflow: hidden;
  cursor: pointer;
}
.progress i {
  display: block;
  height: 100%;
  background: linear-gradient(90deg, #4cc2ff, #7a6cff);
}
.time {
  font-size: 0.76rem;
  opacity: 0.65;
  font-variant-numeric: tabular-nums;
}
.err {
  margin: 8px 0 0;
  color: #ff7b72;
  font-size: 0.82rem;
}
</style>
