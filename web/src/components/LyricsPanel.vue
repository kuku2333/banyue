<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { activeLineIndex, parseLyrics } from '@/lib/lyrics'
import type { Track } from '@/lib/music'

/** 歌词面板：有歌词就跟着播滚动高亮；没有可以载入 .lrc 或粘贴 */
const props = defineProps<{
  track: Track | null
  currentTime: number
  lyrics: string
}>()
const emit = defineEmits<{ load: [text: string] }>()

const listEl = ref<HTMLElement | null>(null)
const importing = ref(false)
const pasteOpen = ref(false)
const pasted = ref('')
const error = ref('')

const lines = computed(() => parseLyrics(props.lyrics))
const active = computed(() => activeLineIndex(lines.value, props.currentTime))

const hasTimeline = computed(() => lines.value.some((line) => line.time >= 0))

/** 当前行滚到可视区中间 */
watch(active, async (index) => {
  if (index < 0) return
  await nextTick()
  const container = listEl.value
  const el = container?.querySelector<HTMLElement>(`[data-line="${index}"]`)
  if (!container || !el) return
  container.scrollTo({ top: el.offsetTop - container.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' })
})

watch(
  () => props.track?.id,
  () => {
    pasteOpen.value = false
    pasted.value = ''
    error.value = ''
  },
)

async function pickFile(): Promise<void> {
  error.value = ''
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.lrc,.txt,text/plain'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    importing.value = true
    try {
      const text = await file.text()
      if (!text.trim()) {
        error.value = '这个文件是空的'
        return
      }
      emit('load', text)
    } catch {
      error.value = '读取失败'
    } finally {
      importing.value = false
    }
  }
  input.click()
}

function submitPaste(): void {
  const text = pasted.value.trim()
  if (!text) return
  emit('load', text)
  pasted.value = ''
  pasteOpen.value = false
}
</script>

<template>
  <div class="lyrics">
    <div v-if="props.lyrics && lines.length" ref="listEl" class="lyric-list" :class="{ timed: hasTimeline }">
      <p
        v-for="(line, index) in lines"
        :key="index"
        :data-line="index"
        class="lyric-line"
        :class="{ on: hasTimeline && index === active, past: hasTimeline && index < active }"
      >
        {{ line.text }}
      </p>
    </div>

    <div v-else class="lyric-empty">
      <p class="muted small">
        这首歌还没有歌词。歌词可以是同名 <b>.lrc</b> 文件（跟音频一起导入最好），
        也可以手动载入或粘贴。
      </p>
    </div>

    <div class="lyric-actions">
      <button type="button" class="btn small-btn" :disabled="importing" @click="pickFile">
        {{ importing ? '读取中…' : props.lyrics ? '换一份歌词' : '载入歌词文件' }}
      </button>
      <button type="button" class="btn small-btn" @click="pasteOpen = !pasteOpen">
        {{ pasteOpen ? '收起粘贴框' : '粘贴歌词' }}
      </button>
    </div>

    <div v-if="pasteOpen" class="paste">
      <textarea v-model="pasted" rows="5" placeholder="粘贴歌词，支持 [00:12.34] 这种 LRC 时间轴，也支持纯文本" />
      <button type="button" class="btn small-btn" :disabled="!pasted.trim()" @click="submitPaste">保存歌词</button>
    </div>

    <p v-if="error" class="lyric-err">{{ error }}</p>
  </div>
</template>

<style scoped>
.lyrics {
  margin-top: 10px;
}
.lyric-list {
  max-height: 190px;
  overflow-y: auto;
  padding: 8px 6px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
  scrollbar-width: thin;
}
.lyric-line {
  margin: 0;
  padding: 3px 8px;
  font-size: 0.82rem;
  line-height: 1.6;
  opacity: 0.45;
  transition:
    opacity 0.2s ease,
    color 0.2s ease;
}
.lyric-list.timed .lyric-line.on {
  opacity: 1;
  color: #7cc4ff;
  font-weight: 600;
}
.lyric-list.timed .lyric-line.past {
  opacity: 0.32;
}
.lyric-empty {
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px dashed var(--line-strong);
  background: rgba(255, 255, 255, 0.02);
}
.lyric-empty b {
  color: #7cc4ff;
}
.lyric-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.paste {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.paste textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: rgba(0, 0, 0, 0.35);
  color: inherit;
  font-size: 0.8rem;
  resize: vertical;
}
.lyric-err {
  margin: 6px 0 0;
  color: #ff7b72;
  font-size: 0.78rem;
}
</style>
