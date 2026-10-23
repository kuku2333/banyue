<script setup lang="ts">
import { computed } from 'vue'
import type { Track } from '@/lib/music'
import { usePlayerStore } from '@/stores/player'

/** 唱片机：当前曲目是一张旋转的黑胶，唱臂搭在上面；点列表里的唱片就放上来播 */
const player = usePlayerStore()

/** 由曲目 id 推一个稳定的色相，做唱片中心标签 */
function hueFrom(text: string): number {
  let hash = 0
  for (const ch of text) hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) % 360
  return hash
}

const current = computed<Track | null>(() => player.current)
const labelHue = computed(() => hueFrom(current.value?.id ?? 'banyue'))
const labelStyle = computed(() => ({
  background: `conic-gradient(from 210deg,
    hsl(${labelHue.value} 62% 46%),
    hsl(${(labelHue.value + 40) % 360} 70% 58%),
    hsl(${(labelHue.value + 80) % 360} 62% 44%),
    hsl(${labelHue.value} 62% 46%))`,
}))
const initial = computed(() => (current.value?.title ?? '空').slice(0, 1))

const pct = computed(() => `${Math.round(player.progress * 100)}%`)

function onSeek(event: MouseEvent): void {
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  player.seek((event.clientX - rect.left) / rect.width)
}
</script>

<template>
  <div class="turntable" :class="{ spinning: player.playing }">
    <!-- 唱盘 -->
    <div class="tt-deck">
      <div class="tt-platter">
        <div class="tt-vinyl" :class="{ spin: player.playing }">
          <div class="tt-grooves" />
          <div class="tt-shine" />
          <div class="tt-label" :style="labelStyle">
            <span>{{ initial }}</span>
          </div>
          <div class="tt-spindle" />
        </div>
      </div>
      <!-- 唱臂 -->
      <div class="tt-arm" :class="{ on: player.playing }">
        <div class="tt-arm-base" />
        <div class="tt-arm-rod" />
        <div class="tt-arm-head" />
      </div>
    </div>

    <!-- 信息与控制 -->
    <div class="tt-info">
      <span class="tt-now">{{ current ? (player.playing ? '正在播放' : '已暂停') : '唱机待命' }}</span>
      <h3 class="tt-title">{{ current?.title ?? '点一张唱片放上来' }}</h3>
      <p class="tt-artist">{{ current?.artist ?? '列表里的任意一张都行' }}</p>

      <div class="tt-progress" @click="onSeek">
        <i :style="{ width: pct }" />
      </div>
      <div class="tt-times">
        <span>{{ Math.round(player.currentTime) }}s</span>
        <span>{{ Math.round(player.duration) }}s</span>
      </div>

      <p v-if="player.error" class="tt-error">{{ player.error }}</p>

      <div class="tt-ctrl">
        <button type="button" class="tt-btn" aria-label="上一首" @click="player.shift(-1)">‹‹</button>
        <button type="button" class="tt-btn main" :aria-label="player.playing ? '暂停' : '播放'" @click="player.toggle()">
          {{ player.playing ? '❚❚' : '▶' }}
        </button>
        <button type="button" class="tt-btn" aria-label="下一首" @click="player.shift(1)">››</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.turntable {
  display: flex;
  gap: 22px;
  align-items: center;
  padding: 18px 20px;
  border: 1px solid var(--line, #26303c);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 60%),
    #12161d;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
}

/* ---------- 唱盘 ---------- */
.tt-deck {
  position: relative;
  width: 190px;
  height: 190px;
  flex: none;
}
.tt-platter {
  position: absolute;
  inset: 0;
  border-radius: 22px;
  background: linear-gradient(150deg, #2a2118, #17120c 65%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.08),
    0 10px 22px rgba(0, 0, 0, 0.45);
}
.tt-vinyl {
  position: absolute;
  inset: 12px;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 50%, #101010 0 26%, #060606 27% 100%);
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}
.tt-vinyl.spin {
  animation: tt-spin 3.6s linear infinite;
}
@keyframes tt-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 唱片细纹 */
.tt-grooves {
  position: absolute;
  inset: 8%;
  border-radius: 50%;
  background: repeating-radial-gradient(
    circle at 50% 50%,
    rgba(255, 255, 255, 0.05) 0 1px,
    rgba(255, 255, 255, 0) 1px 4px
  );
}
/* 流动的光泽 */
.tt-shine {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: conic-gradient(
    from 0deg,
    rgba(255, 255, 255, 0.14),
    rgba(255, 255, 255, 0) 25%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0) 75%,
    rgba(255, 255, 255, 0.14)
  );
  mix-blend-mode: screen;
}
.tt-label {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 42%;
  height: 42%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  display: grid;
  place-items: center;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}
.tt-label span {
  color: rgba(255, 255, 255, 0.92);
  font-weight: 700;
  font-size: 1.35rem;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.tt-spindle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #e8e8e8, #7c7c7c 70%);
}

/* ---------- 唱臂 ---------- */
.tt-arm {
  position: absolute;
  right: 14px;
  top: 18px;
  width: 12px;
  height: 12px;
  transform-origin: 50% 50%;
  transform: rotate(-26deg);
  transition: transform 0.5s cubic-bezier(0.3, 1.4, 0.5, 1);
}
.tt-arm.on {
  transform: rotate(14deg);
}
.tt-arm-base {
  position: absolute;
  right: -8px;
  top: -8px;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #d8dbe0, #6b7178 75%);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5);
}
.tt-arm-rod {
  position: absolute;
  right: 2px;
  top: 4px;
  width: 6px;
  height: 118px;
  border-radius: 3px;
  background: linear-gradient(90deg, #f0f2f4, #8d949c);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
}
.tt-arm-head {
  position: absolute;
  right: -1px;
  top: 116px;
  width: 13px;
  height: 20px;
  border-radius: 3px;
  background: linear-gradient(160deg, #23262b, #0c0e11);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.55);
}

/* ---------- 信息区 ---------- */
.tt-info {
  flex: 1;
  min-width: 0;
}
.tt-now {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(76, 194, 255, 0.12);
  color: #4cc2ff;
  font-size: 0.72rem;
}
.spinning .tt-now {
  background: rgba(255, 94, 120, 0.14);
  color: #ff5e78;
}
.tt-title {
  margin: 8px 0 2px;
  font-size: 1.25rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tt-artist {
  margin: 0 0 12px;
  opacity: 0.72;
  font-size: 0.9rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tt-progress {
  height: 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.09);
  overflow: hidden;
  cursor: pointer;
}
.tt-progress i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4cc2ff, #7a6cff);
}
.tt-times {
  display: flex;
  justify-content: space-between;
  margin: 4px 0 12px;
  opacity: 0.55;
  font-size: 0.72rem;
}
.tt-error {
  margin: 0 0 10px;
  color: #ff7b72;
  font-size: 0.8rem;
}
.tt-ctrl {
  display: flex;
  gap: 10px;
  align-items: center;
}
.tt-btn {
  min-width: 42px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  color: #e7edf2;
  font-size: 0.95rem;
  cursor: pointer;
  transition:
    transform 0.12s ease,
    background 0.15s ease;
}
.tt-btn:hover {
  background: rgba(255, 255, 255, 0.12);
  transform: translateY(-1px);
}
.tt-btn.main {
  min-width: 58px;
  background: #4cc2ff;
  border-color: transparent;
  color: #06222e;
  font-weight: 700;
}
.tt-btn.main:hover {
  background: #6fd0ff;
}

@media (max-width: 767px) {
  .turntable {
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }
  .tt-info {
    width: 100%;
    text-align: center;
  }
  .tt-ctrl {
    justify-content: center;
  }
}
</style>
