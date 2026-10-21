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
  const queue = ref<Track[]>([])
  const index = ref(-1)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const collapsed = ref(false)
  const error = ref('')
  const loading = ref(false)
  const favorites = useStorage<Track[]>('banyue:favorites', [])
  const mode = useStorage<PlayMode>('banyue:player:mode', 'order')
  const volume = useStorage<number>('banyue:player:volume', 0.8)

  let audio: HTMLAudioElement | null = null
  let objectUrl: string | null = null
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
    })
    element.addEventListener('pause', () => {
      playing.value = false
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

  async function resolveSource(track: Track): Promise<string | null> {
    if (track.local) {
      // 动态引入：Dexie 只在真的播放本地文件时才加载，避免进主包
      const { getTrackBlob } = await import('@/lib/db')
      const blob = await getTrackBlob(track.id)
      if (!blob) return null
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = URL.createObjectURL(blob)
      return objectUrl
    }
    const url = await resolvePreview(track)
    if (!url) return null
    const cached = blobCache.get(url)
    if (cached) return cached
    // 转成 blob 再播：既绕开跨域限制，也让 Web Audio 能拿到频谱做律动
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(String(response.status))
      const blob = await response.blob()
      const object = URL.createObjectURL(blob)
      blobCache.set(url, object)
      return object
    } catch {
      return url
    }
  }

  async function load(target: Track, autoplay = true): Promise<void> {
    loading.value = true
    error.value = ''
    try {
      const src = await resolveSource(target)
      if (!src) {
        error.value = '没有找到可播放的音源'
        return
      }
      const element = ensureAudio()
      ensureAnalyser(element)
      element.src = src
      currentTime.value = 0
      duration.value = 0
      if (autoplay) await element.play()
    } catch {
      error.value = '播放失败，可能是网络或格式问题'
      playing.value = false
    } finally {
      loading.value = false
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
    element.pause()
    element.removeAttribute('src')
    element.load()
    queue.value = []
    index.value = -1
    currentTime.value = 0
    duration.value = 0
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
    analyser,
    current,
    progress,
    hasNext,
    hasPrev,
    playList,
    playOne,
    toggleAt,
    toggle,
    next,
    prev,
    advance,
    jumpTo,
    removeAt,
    cycleMode,
    setVolume,
    seek,
    close,
    isFavorite,
    toggleFavorite,
  }
})
