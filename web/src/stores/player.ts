import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { useStorage } from '@vueuse/core'
import type { Track } from '@/lib/music'
import { resolvePreview } from '@/lib/music'

export type PlayMode = 'order' | 'repeat' | 'shuffle'

export const PLAY_MODES: { id: PlayMode; label: string; icon: string }[] = [
  { id: 'order', label: '顺序播放', icon: '→' },
  { id: 'repeat', label: '单曲循环', icon: '↻' },
  { id: 'shuffle', label: '随机播放', icon: '⇄' },
]

export const usePlayerStore = defineStore('player', () => {
  // 队列和当前曲目持久化：刷新页面不用重新点一遍
  const queue = useStorage<Track[]>('banyue:player:queue', [])
  const index = useStorage<number>('banyue:player:index', -1)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const collapsed = ref(false)
  const error = ref('')
  const loading = ref(false)
  const favorites = useStorage<Track[]>('banyue:favorites', [])
  const mode = useStorage<PlayMode>('banyue:player:mode', 'order')
  const volume = useStorage<number>('banyue:player:volume', 0.8)
  /** 倍速：0.5 / 0.75 / 1 / 1.25 / 1.5 / 1.75 / 2 */
  const rate = useStorage<number>('banyue:player:rate', 1)
  /** 最近播放（最新在前，最多 30 首） */
  const recent = useStorage<Track[]>('banyue:player:recent', [])
  /** 睡眠定时：剩余秒数，0 表示没开 */
  const sleepRemaining = ref(0)
  let sleepTimer: ReturnType<typeof setInterval> | null = null
  /** 淡入淡出时长（毫秒） */
  const FADE_MS = 260

  let audio: HTMLAudioElement | null = null
  let objectUrl: string | null = null
  let loadToken = 0
  let audioContext: AudioContext | null = null
  const analyser = shallowRef<AnalyserNode | null>(null)
  const blobCache = new Map<string, string>()

  function ensureAnalyser(element: HTMLAudioElement): void {
    if (audioContext) {
      if (audioContext.state === 'suspended') void audioContext.resume()
      return
    }
    try {
      audioContext = new AudioContext()
      const source = audioContext.createMediaElementSource(element)
      const node = audioContext.createAnalyser()
      node.fftSize = 128
      node.smoothingTimeConstant = 0.82
      source.connect(node)
      node.connect(audioContext.destination)
      analyser.value = node
    } catch {
      analyser.value = null
    }
  }

  const current = computed<Track | null>(() => queue.value[index.value] ?? null)
  const progress = computed(() => (duration.value > 0 ? currentTime.value / duration.value : 0))
  const hasNext = computed(() => index.value < queue.value.length - 1)
  const hasPrev = computed(() => index.value > 0)

  function ensureAudio(): HTMLAudioElement {
    if (audio) return audio
    const element = new Audio()
    element.preload = 'metadata'
    element.volume = volume.value
    element.addEventListener('timeupdate', () => {
      currentTime.value = element.currentTime
    })
    element.addEventListener('loadedmetadata', () => {
      duration.value = Number.isFinite(element.duration) ? element.duration : 0
    })
    element.addEventListener('play', () => {
      playing.value = true
      updateMediaSession()
    })
    element.addEventListener('pause', () => {
      playing.value = false
      updateMediaSession()
    })
    element.addEventListener('ratechange', () => {
      rate.value = element.playbackRate
    })
    element.addEventListener('ended', () => {
      void advance()
    })
    element.addEventListener('error', () => {
      playing.value = false
      error.value = '这首暂时播不了，换一首试试'
      setTimeout(() => (error.value = ''), 3000)
    })
    audio = element
    return element
  }

  async function resolveSource(track: Track): Promise<{ url: string; local: boolean } | null> {
    if (track.local) {
      // 动态引入：Dexie 只在真的播放本地文件时才加载，避免进主包
      const { getTrackBlob } = await import('@/lib/db')
      const blob = await getTrackBlob(track.id)
      if (!blob) return null
      return { url: URL.createObjectURL(blob), local: true }
    }
    // 云端曲：本地有同指纹的文件就直接播本地，省流量、也更快
    if (track.source === 'cloud' && track.hash) {
      const { findTrackByHash, getTrackBlob } = await import('@/lib/db')
      const local = await findTrackByHash(track.hash)
      if (local) {
        const blob = await getTrackBlob(local.id)
        if (blob) return { url: URL.createObjectURL(blob), local: true }
      }
    }
    const url = await resolvePreview(track)
    if (!url) return null
    const cached = blobCache.get(url)
    if (cached) return { url: cached, local: false }
    // 转成 blob 再播：既绕开跨域限制，也让 Web Audio 能拿到频谱做律动
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(String(response.status))
      const blob = await response.blob()
      const object = URL.createObjectURL(blob)
      blobCache.set(url, object)
      return { url: object, local: false }
    } catch {
      return { url, local: false }
    }
  }

  /* ---------- 淡入淡出 ---------- */

  let fadeRaf = 0

  /** 把音量从当前值渐变到 target，用于切歌不爆音 */
  function fadeTo(target: number, ms = FADE_MS): Promise<void> {
    const element = ensureAudio()
    cancelAnimationFrame(fadeRaf)
    return new Promise((resolve) => {
      const from = element.volume
      const startedAt = performance.now()
      const step = (now: number) => {
        const t = Math.min(1, (now - startedAt) / ms)
        element.volume = Math.min(1, Math.max(0, from + (target - from) * t))
        if (t < 1) fadeRaf = requestAnimationFrame(step)
        else resolve()
      }
      fadeRaf = requestAnimationFrame(step)
    })
  }

  /** 恢复成本次会话设定的音量（淡入结束后的落点） */
  function restoreVolume(): void {
    const element = ensureAudio()
    element.volume = volume.value
  }

  /* ---------- 系统媒体控制（锁屏 / 通知栏 / 耳机线控） ---------- */

  function updateMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const track = current.value
    if (!track) {
      navigator.mediaSession.metadata = null
      return
    }
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title ?? '未知曲目',
        artist: track.artist ?? '',
        album: '半月',
        artwork: track.art ? [{ src: track.art, sizes: '512x512', type: 'image/jpeg' }] : [],
      })
      navigator.mediaSession.playbackState = playing.value ? 'playing' : 'paused'
    } catch {
      /* 个别浏览器不支持 MediaMetadata，忽略 */
    }
  }

  function bindMediaSession(): void {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
    const session = navigator.mediaSession
    const set = (action: MediaSessionAction, handler: () => void): void => {
      try {
        session.setActionHandler(action, handler)
      } catch {
        /* 不支持的动作会抛错，忽略 */
      }
    }
    set('play', () => void toggle())
    set('pause', () => void toggle())
    set('previoustrack', () => void prev())
    set('nexttrack', () => void next())
    set('seekbackward', () => seek(progress.value - 0.05))
    set('seekforward', () => seek(progress.value + 0.05))
    try {
      session.setActionHandler('seekto', (details: MediaSessionActionDetails) => {
        if (details.seekTime != null && duration.value) seek(details.seekTime / duration.value)
      })
    } catch {
      /* 不支持 seekto 的浏览器忽略 */
    }
  }

  /* ---------- 睡眠定时 ---------- */

  function clearSleepTimer(): void {
    if (sleepTimer) {
      clearInterval(sleepTimer)
      sleepTimer = null
    }
    sleepRemaining.value = 0
  }

  /** 设定睡眠定时：到点后渐弱暂停 */
  function setSleepTimer(minutes: number): void {
    clearSleepTimer()
    if (minutes <= 0) return
    sleepRemaining.value = Math.round(minutes * 60)
    sleepTimer = setInterval(() => {
      sleepRemaining.value -= 1
      if (sleepRemaining.value > 0) return
      clearSleepTimer()
      // 渐弱再暂停，别把人吓醒
      void fadeTo(0, 1200).then(() => {
        ensureAudio().pause()
        restoreVolume()
      })
    }, 1000)
  }

  /* ---------- 倍速 ---------- */

  const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

  function setRate(value: number): void {
    const element = ensureAudio()
    const next = RATES.includes(value) ? value : 1
    rate.value = next
    element.playbackRate = next
  }

  /** 循环切换倍速 */
  function cycleRate(): void {
    const at = RATES.indexOf(rate.value)
    setRate(RATES[(at + 1) % RATES.length]!)
  }

  /* ---------- 最近播放 ---------- */

  function pushRecent(track: Track): void {
    const rest = recent.value.filter((item) => item.id !== track.id)
    recent.value = [track, ...rest].slice(0, 30)
  }

  async function load(target: Track, autoplay = true): Promise<void> {
    // 快速连点切歌时，先发起的那次请求可能后返回；用令牌丢掉过期的结果
    const token = ++loadToken
    loading.value = true
    error.value = ''
    try {
      const resolved = await resolveSource(target)
      if (token !== loadToken) {
        if (resolved?.local) URL.revokeObjectURL(resolved.url)
        return
      }
      if (!resolved) {
        error.value = '没有找到可播放的音源'
        return
      }
      const element = ensureAudio()
      ensureAnalyser(element)
      // 切歌时先把旧音量淡出，换源后淡入，避免爆音
      const wasPlaying = !element.paused && element.src
      if (wasPlaying) await fadeTo(0)
      if (objectUrl && objectUrl !== resolved.url) URL.revokeObjectURL(objectUrl)
      objectUrl = resolved.local ? resolved.url : null
      element.src = resolved.url
      element.playbackRate = rate.value
      currentTime.value = 0
      duration.value = 0
      pushRecent(target)
      updateMediaSession()
      if (autoplay) {
        await element.play()
        if (wasPlaying) await fadeTo(volume.value)
        else restoreVolume()
      } else {
        restoreVolume()
      }
    } catch {
      if (token === loadToken) {
        error.value = '播放失败，可能是网络或格式问题'
        playing.value = false
      }
    } finally {
      if (token === loadToken) loading.value = false
    }
  }

  async function playList(tracks: Track[], start = 0): Promise<void> {
    if (!tracks.length) return
    queue.value = [...tracks]
    index.value = Math.min(Math.max(start, 0), tracks.length - 1)
    collapsed.value = false
    await load(queue.value[index.value]!)
  }

  async function playOne(track: Track): Promise<void> {
    await playList([track])
  }

  /** 双击列表里的某一首：正在播就暂停，否则从这首开始播 */
  async function toggleAt(tracks: Track[], target: number): Promise<void> {
    const track = tracks[target]
    if (!track) return
    if (current.value?.id === track.id) {
      await toggle()
      return
    }
    await playList(tracks, target)
  }

  async function toggle(): Promise<void> {
    const element = ensureAudio()
    if (!current.value) return
    if (!element.src) {
      await load(current.value)
      return
    }
    if (element.paused) await element.play()
    else element.pause()
  }

  async function next(): Promise<void> {
    if (index.value >= queue.value.length - 1) {
      ensureAudio().pause()
      return
    }
    index.value++
    await load(queue.value[index.value]!)
  }

  /** 切换上一首/下一首：正在播就接着播，暂停状态只切歌不播放 */
  async function shift(step: number): Promise<void> {
    const target = index.value + step
    if (target < 0 || target >= queue.value.length) return
    const autoplay = playing.value
    index.value = target
    await load(queue.value[target]!, autoplay)
  }

  async function prev(): Promise<void> {
    const element = ensureAudio()
    if (element.currentTime > 3) {
      element.currentTime = 0
      return
    }
    if (index.value <= 0) {
      element.currentTime = 0
      return
    }
    index.value--
    await load(queue.value[index.value]!)
  }

  /** 一首播完之后的行为：单曲循环 / 随机 / 顺序 */
  async function advance(): Promise<void> {
    if (!current.value) return
    if (mode.value === 'repeat') {
      const element = ensureAudio()
      element.currentTime = 0
      await element.play()
      return
    }
    if (mode.value === 'shuffle' && queue.value.length > 1) {
      let target = index.value
      while (target === index.value) target = Math.floor(Math.random() * queue.value.length)
      index.value = target
      await load(queue.value[index.value]!)
      return
    }
    if (hasNext.value) {
      await next()
      return
    }
    playing.value = false
  }

  function jumpTo(target: number): void {
    const track = queue.value[target]
    if (!track) return
    index.value = target
    void load(track)
  }

  function removeAt(target: number): void {
    if (target < 0 || target >= queue.value.length) return
    const wasCurrent = target === index.value
    queue.value.splice(target, 1)
    if (!queue.value.length) {
      close()
      return
    }
    if (target < index.value) index.value--
    else if (wasCurrent) {
      index.value = Math.min(index.value, queue.value.length - 1)
      void load(queue.value[index.value]!)
      return
    }
    index.value = Math.min(index.value, queue.value.length - 1)
  }

  /** 队列内拖动排序：把 from 移到 to，正在播的那首跟着走 */
  function moveTo(from: number, to: number): void {
    if (from === to) return
    if (from < 0 || from >= queue.value.length) return
    if (to < 0 || to >= queue.value.length) return
    const currentTrack = current.value
    const list = [...queue.value]
    const [moved] = list.splice(from, 1)
    if (!moved) return
    list.splice(to, 0, moved)
    queue.value = list
    // 重新定位当前曲目，别让正在播的歌变成别的
    if (currentTrack) {
      const at = list.findIndex((item) => item.id === currentTrack.id)
      if (at >= 0) index.value = at
    }
  }

  function cycleMode(): void {
    const order = PLAY_MODES.map((item) => item.id)
    mode.value = order[(order.indexOf(mode.value) + 1) % order.length]!
  }

  function setVolume(value: number): void {
    volume.value = Math.min(1, Math.max(0, value))
    const element = ensureAudio()
    element.volume = volume.value
  }

  function seek(ratio: number): void {
    const element = ensureAudio()
    if (!duration.value) return
    element.currentTime = Math.min(Math.max(ratio, 0), 1) * duration.value
  }

  function close(): void {
    const element = ensureAudio()
    loadToken++
    element.pause()
    element.removeAttribute('src')
    element.load()
    // 缓存里全是 blob: URL，不主动释放会一直占着内存
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
      objectUrl = null
    }
    for (const url of blobCache.values()) URL.revokeObjectURL(url)
    blobCache.clear()
    queue.value = []
    index.value = -1
    currentTime.value = 0
    duration.value = 0
  }

  /**
   * 曲库版本号：改了歌名/歌手等元数据后自增，
   * 列表页 watch 它来重新读库，保证各处同步刷新（Vue 响应式）。
   */
  const libraryRev = ref(0)
  function markLibraryChanged(): void {
    libraryRev.value += 1
  }

  function isFavorite(id: string): boolean {
    return favorites.value.some((track) => track.id === id)
  }

  function toggleFavorite(track: Track): void {
    if (isFavorite(track.id)) {
      favorites.value = favorites.value.filter((item) => item.id !== track.id)
    } else {
      favorites.value = [...favorites.value, track]
    }
  }

  return {
    queue,
    index,
    playing,
    currentTime,
    duration,
    collapsed,
    error,
    loading,
    favorites,
    mode,
    volume,
    rate,
    recent,
    sleepRemaining,
    analyser,
    current,
    libraryRev,
    markLibraryChanged,
    progress,
    hasNext,
    hasPrev,
    playList,
    playOne,
    toggleAt,
    toggle,
    next,
    prev,
    shift,
    advance,
    jumpTo,
    removeAt,
    moveTo,
    cycleMode,
    setVolume,
    seek,
    close,
    isFavorite,
    toggleFavorite,
    setRate,
    cycleRate,
    setSleepTimer,
    clearSleepTimer,
    bindMediaSession,
    updateMediaSession,
  }
})
