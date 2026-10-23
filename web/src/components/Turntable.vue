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
const canToggle = computed(() => Boolean(current.value))

/** 点整块唱片机 = 播放/暂停（没有曲目时不做任何事） */
function onTap(): void {
  if (!current.value) return
  void player.toggle()
}
</script>

<template>
  <div
    class="turntable"
    :class="{ spinning: player.playing, clickable: canToggle }"
    :role="canToggle ? 'button' : 'group'"
    :tabindex="canToggle ? 0 : -1"
    :title="canToggle ? (player.playing ? '点击暂停' : '点击继续播放') : '先从右边点一张唱片'"
    @click="onTap"
    @keydown.enter.prevent="onTap"
    @keydown.space.prevent="onTap"
  >
    <!-- 唱盘 -->
    <div class="tt-deck">
      <div class="tt-platter">
        <div class="tt-vinyl" :class="{ spin: player.playing }">
          <div class="tt-grooves" />
          <div class="tt-shine" />
          <div class="tt-label" :style="labelStyle">
            <img v-if="current?.art" class="tt-cover" :src="current.art" alt="" />
            <span v-else>{{ initial }}</span>
          </div>
          <div class="tt-spindle" />
        </div>
      </div>
      <!-- 唱臂 -->
      <div class="tt-arm" :class="{ on: player.playing }">
        <!-- 尾部配重 -->
        <div class="tt-counterweight" />
        <!-- 转轴（带螺丝） -->
        <div class="tt-arm-base"><i class="tt-screw" /></div>
        <!-- 臂杆 -->
        <div class="tt-arm-rod" />
        <!-- 唱头 + 唱针 -->
        <div class="tt-arm-head">
          <i class="tt-cart-shell" />
          <i class="tt-needle" />
        </div>
      </div>
    </div>

    <!-- 信息（播放控制交给悬浮播放器，这里不重复） -->
    <div class="tt-info">
      <h3 class="tt-title">{{ current?.title ?? '点一张唱片放上来' }}</h3>
      <p class="tt-artist">{{ current?.artist ?? '唱片墙上的任意一张都行' }}</p>
      <p v-if="player.error" class="tt-error">{{ player.error }}</p>
    </div>
  </div>
</template>

<style scoped>
.turntable {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 20px 18px 18px;
  border: 1px solid var(--line, #26303c);
  border-radius: 18px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0) 60%),
    #12161d;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
  transition:
    border-color 0.18s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}
.turntable.clickable {
  cursor: pointer;
}
.turntable.clickable:hover {
  border-color: rgba(124, 196, 255, 0.45);
  transform: translateY(-2px);
  box-shadow: 0 22px 50px rgba(0, 0, 0, 0.42);
}
.turntable.clickable:focus-visible {
  outline: 2px solid #4cc2ff;
  outline-offset: 3px;
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
.tt-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 50%;
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

/* ---------- 唱臂：纯机械风（金属杆 + 配重 + 唱头 + 指针） ---------- */
.tt-arm {
  position: absolute;
  right: 12px;
  top: 16px;
  width: 12px;
  height: 12px;
  transform-origin: 50% 50%;
  transform: rotate(-28deg);
  transition: transform 0.55s cubic-bezier(0.25, 1.25, 0.45, 1);
}
.tt-arm.on {
  transform: rotate(15deg);
}

/* 转轴：金属圆盘 + 十字螺丝 */
.tt-arm-base {
  position: absolute;
  right: -12px;
  top: -12px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 38% 32%, #eef2f6 0 8%, #b9c2cc 30%, #7b858f 58%, #3a4149 88%);
  box-shadow:
    0 3px 9px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(255, 255, 255, 0.24),
    inset 0 -3px 7px rgba(0, 0, 0, 0.5);
}
.tt-screw {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 11px;
  height: 11px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #4a525b, #12161a);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.2);
}
/* 十字槽 */
.tt-screw::before,
.tt-screw::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  background: rgba(0, 0, 0, 0.7);
}
.tt-screw::before {
  width: 7px;
  height: 1.5px;
  transform: translate(-50%, -50%);
}
.tt-screw::after {
  width: 1.5px;
  height: 7px;
  transform: translate(-50%, -50%);
}

/* 臂杆：圆柱金属杆 */
.tt-arm-rod {
  position: absolute;
  right: 3px;
  top: 0;
  width: 7px;
  height: 122px;
  border-radius: 3.5px;
  background: linear-gradient(
    90deg,
    #6d7681 0%,
    #e9eef3 22%,
    #c2cbd4 42%,
    #8d97a2 68%,
    #59626c 100%
  );
  box-shadow:
    0 2px 5px rgba(0, 0, 0, 0.45),
    inset 0 0 2px rgba(255, 255, 255, 0.4);
}

/* 尾部配重块 */
.tt-counterweight {
  position: absolute;
  right: -3px;
  top: -22px;
  width: 16px;
  height: 20px;
  border-radius: 3px;
  background: linear-gradient(160deg, #4a525c 0%, #1c2229 60%, #0a0d11 100%);
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.55),
    inset 0 1px 0 rgba(255, 255, 255, 0.18);
}

/* 唱头：金属外壳 */
.tt-arm-head {
  position: absolute;
  right: -4px;
  top: 118px;
  width: 20px;
  height: 18px;
  border-radius: 2px;
  background: linear-gradient(150deg, #d5dce4 0%, #9aa4af 38%, #5a636d 72%, #2b3138 100%);
  box-shadow:
    0 3px 8px rgba(0, 0, 0, 0.6),
    inset 0 0 0 1px rgba(255, 255, 255, 0.28);
}
/* 唱头外框的薄边 */
.tt-cart-shell {
  position: absolute;
  left: 2px;
  right: 2px;
  bottom: 2px;
  height: 4px;
  border-radius: 1px;
  background: linear-gradient(180deg, #3d454e, #171c21);
}
/* 唱针：细金属针尖 */
.tt-needle {
  position: absolute;
  left: 50%;
  bottom: -7px;
  width: 2px;
  height: 9px;
  transform: translateX(-50%);
  background: linear-gradient(180deg, #e7edf3 0%, #aab4be 45%, #6d757e 100%);
  clip-path: polygon(38% 0, 62% 0, 100% 100%, 0 100%);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
}

/* ---------- 信息区 ---------- */
.tt-info {
  width: 100%;
  min-width: 0;
  text-align: center;
  padding-bottom: 4px;
}
/* 曲名：渐变字 + 轻微光晕，播放时流动 */
.tt-title {
  margin: 0 0 4px;
  font-size: 1.18rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  background: linear-gradient(100deg, #ffffff 0%, #9fd8ff 38%, #c9b6ff 68%, #ffffff 100%);
  background-size: 220% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  text-shadow: 0 0 24px rgba(124, 196, 255, 0.22);
}
.spinning .tt-title {
  animation: tt-shimmer 4.5s linear infinite;
}
@keyframes tt-shimmer {
  from { background-position: 0% 50%; }
  to { background-position: 220% 50%; }
}
.tt-artist {
  margin: 0;
  font-size: 0.84rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tt-error {
  margin: 0 0 10px;
  color: #ff7b72;
  font-size: 0.8rem;
}

@media (max-width: 767px) {
  .turntable {
    gap: 12px;
    padding: 14px;
  }
  .tt-title {
    font-size: 1.02rem;
  }
}
</style>
