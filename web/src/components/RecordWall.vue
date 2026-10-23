<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Track } from '@/lib/music'

/** 唱片墙：一张张圆唱片排好，唱片上写歌名，悬停放大名字，点击放上唱片机 */
const props = defineProps<{
  tracks: Track[]
  currentId?: string
  playing?: boolean
  /** 批量管理：选中集合与开关 */
  selectMode?: boolean
  selectedIds?: string[]
  /** 是否允许选中（云端只允许自己的） */
  selectable?: (track: Track, index: number) => boolean
}>()
const emit = defineEmits<{
  play: [index: number]
  select: [id: string]
}>()

/* 分页：每行 5 张 × 4 行 = 20 张/页，免得一直滑 */
const PAGE_SIZE = 20
const page = ref(0)
const pageCount = computed(() => Math.max(1, Math.ceil(props.tracks.length / PAGE_SIZE)))
/** 当前页的数据（带全局索引，点击播放要用原始 index） */
const pageTracks = computed(() =>
  props.tracks.slice(page.value * PAGE_SIZE, page.value * PAGE_SIZE + PAGE_SIZE).map((track, i) => ({
    track,
    index: page.value * PAGE_SIZE + i,
  })),
)

function gotoPage(next: number): void {
  page.value = Math.min(Math.max(0, next), pageCount.value - 1)
}

// 换列表（换地区/换 tab）时回到第一页
watch(
  () => props.tracks,
  () => {
    page.value = 0
  },
)

function hueOf(text: string): number {
  let hash = 0
  for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return hash
}

function labelStyle(track: Track) {
  const hue = hueOf(track.id)
  return {
    background: `conic-gradient(from 210deg,
      hsl(${hue} 62% 46%),
      hsl(${(hue + 40) % 360} 70% 58%),
      hsl(${(hue + 80) % 360} 62% 44%),
      hsl(${hue} 62% 46%))`,
  }
}

const isSelected = (id: string): boolean => (props.selectedIds ?? []).includes(id)

function onClick(event: MouseEvent, track: Track, index: number): void {
  if ((event.target as HTMLElement).closest('button')) return
  if (props.selectMode) {
    if (!props.selectable || props.selectable(track, index)) emit('select', track.id)
    return
  }
  emit('play', index)
}

const spinning = (track: Track): boolean => props.currentId === track.id && Boolean(props.playing)
const isCurrent = (track: Track): boolean => props.currentId === track.id
</script>

<template>
  <div class="record-wall" :class="{ 'select-mode': props.selectMode }">
    <div
      v-for="{ track, index } in pageTracks"
      :key="track.id"
      class="record"
      :class="{
        spinning: spinning(track),
        current: isCurrent(track),
        selected: props.selectMode && isSelected(track.id),
      }"
      :title="track.title"
      @click="onClick($event, track, index)"
    >
      <div class="record-disc">
        <div class="disc-grooves" />
        <div class="disc-shine" />
        <div class="disc-label" :style="labelStyle(track)">
          <img v-if="track.art" class="disc-cover" :src="track.art" alt="" loading="lazy" />
          <span v-else class="disc-name">{{ track.title }}</span>
        </div>
        <div class="disc-spindle" />
        <span v-if="props.selectMode && isSelected(track.id)" class="disc-check">✓</span>
      </div>
      <p class="record-caption">{{ track.title }}</p>
      <p v-if="track.artist" class="record-artist">{{ track.artist }}</p>
      <div class="record-actions">
        <slot name="actions" :track="track" :index="index" />
      </div>
    </div>

    <div v-if="pageCount > 1" class="wall-pager">
      <button type="button" class="wp-btn" :disabled="page === 0" @click="gotoPage(page - 1)">←</button>
      <span>{{ page + 1 }} / {{ pageCount }}（共 {{ props.tracks.length }} 张）</span>
      <button type="button" class="wp-btn" :disabled="page >= pageCount - 1" @click="gotoPage(page + 1)">→</button>
    </div>
  </div>
</template>

<style scoped>
.record-wall {
  display: grid;
  position: relative;
  grid-template-columns: repeat(auto-fill, minmax(126px, 1fr));
  gap: 18px 14px;
  padding: 6px 2px 8px;
}

.record {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 6px 4px 8px;
  border-radius: 14px;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background 0.18s ease;
}
.record:hover {
  transform: translateY(-3px);
  background: rgba(255, 255, 255, 0.05);
}

/* ---------- 黑胶 ---------- */
.record-disc {
  position: relative;
  width: 106px;
  height: 106px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #101010 0 24%, #060606 25% 100%);
  box-shadow:
    0 8px 18px rgba(0, 0, 0, 0.5),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
  transition:
    transform 0.25s ease,
    box-shadow 0.25s ease;
}
.record:hover .record-disc {
  transform: scale(1.06);
  box-shadow:
    0 12px 26px rgba(0, 0, 0, 0.55),
    0 0 0 2px rgba(124, 196, 255, 0.28);
}
.record.current .record-disc {
  box-shadow:
    0 10px 24px rgba(0, 0, 0, 0.5),
    0 0 0 3px rgba(76, 194, 255, 0.55);
}
.record.spinning .record-disc {
  animation: wall-spin 3.6s linear infinite;
}
@keyframes wall-spin {
  to {
    transform: rotate(360deg);
  }
}

.disc-grooves {
  position: absolute;
  inset: 7%;
  border-radius: 50%;
  background: repeating-radial-gradient(
    circle at 50% 50%,
    rgba(255, 255, 255, 0.05) 0 1px,
    rgba(255, 255, 255, 0) 1px 4px
  );
}
.disc-shine {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    rgba(255, 255, 255, 0.16),
    rgba(255, 255, 255, 0) 25%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0) 75%,
    rgba(255, 255, 255, 0.16)
  );
  mix-blend-mode: screen;
}
.disc-label {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52%;
  height: 52%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  display: grid;
  place-items: center;
  padding: 4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.18);
}
.disc-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
}
.disc-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-align: center;
  font-size: 0.58rem;
  line-height: 1.2;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  word-break: break-all;
}
.disc-spindle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 8px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e8e8e8, #7c7c7c 70%);
}
.disc-check {
  position: absolute;
  right: 2px;
  top: 2px;
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #4cc2ff;
  color: #06222e;
  font-size: 0.8rem;
  font-weight: 800;
}

/* ---------- 唱片下方的名字 ---------- */
.record-caption {
  max-width: 126px;
  margin: 0;
  font-size: 0.78rem;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.record-artist {
  max-width: 126px;
  margin: -2px 0 0;
  font-size: 0.68rem;
  opacity: 0.6;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 悬停时名字明显显示：放大 + 完整展开 */
.record:hover .record-caption {
  color: #7cc4ff;
  text-shadow: 0 0 12px rgba(124, 196, 255, 0.45);
}

.wall-pager {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 14px;
  margin-top: 6px;
  font-size: 0.8rem;
  opacity: 0.8;
}
.wp-btn {
  min-width: 34px;
  padding: 5px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: none;
  color: inherit;
  cursor: pointer;
}
.wp-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.record-actions {
  display: flex;
  gap: 4px;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  min-height: 22px;
}

@media (max-width: 767px) {
  .record-wall {
    grid-template-columns: repeat(auto-fill, minmax(104px, 1fr));
    gap: 14px 10px;
  }
  .record-disc {
    width: 88px;
    height: 88px;
  }
}
</style>
