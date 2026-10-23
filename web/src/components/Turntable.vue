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
        <!-- 尾部配重（带镂空） -->
        <div class="tt-counterweight">
          <i class="tt-cw-slot" />
        </div>

        <!-- 转轴：多层同心结构 + 螺丝阵列 -->
        <div class="tt-arm-base">
          <i class="tt-hub-outer" />
          <i class="tt-hub-mid" />
          <i class="tt-screw" />
          <i class="tt-screw s2" />
          <i class="tt-screw s3" />
          <i class="tt-screw s4" />
        </div>

        <!-- 臂杆：镂空框架（左右主梁 + 横向加强筋） -->
        <div class="tt-arm-rod">
          <i class="tt-rail left" />
          <i class="tt-rail right" />
          <i class="tt-rib r1" />
          <i class="tt-rib r2" />
          <i class="tt-rib r3" />
          <i class="tt-rib r4" />
          <i class="tt-trace" />
        </div>

        <!-- 唱头：分段结构 + 针 -->
        <div class="tt-arm-head">
          <i class="tt-head-cap" />
          <i class="tt-head-body" />
          <i class="tt-head-pin" />
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

/* ---------- 唱臂：CNC 镂空框架 + 精密科技感 ---------- */
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

/* ---------- 转轴：同心多层 + 螺丝阵列 ---------- */
.tt-arm-base {
  position: absolute;
  right: -14px;
  top: -14px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background:
    conic-gradient(from 30deg, #414a54, #2a323a 25%, #4c5762 50%, #262d34 75%, #414a54),
    radial-gradient(circle, #1a1f25, #0d1116);
  box-shadow:
    0 3px 10px rgba(0, 0, 0, 0.6),
    inset 0 0 0 1px rgba(160, 200, 230, 0.22);
}
.tt-hub-outer {
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  border: 1px solid rgba(140, 180, 210, 0.35);
  background: radial-gradient(circle at 40% 34%, rgba(255, 255, 255, 0.14), transparent 62%);
}
.tt-hub-mid {
  position: absolute;
  inset: 9px;
  border-radius: 50%;
  background: radial-gradient(circle at 42% 36%, #39424c, #12171c 78%);
  box-shadow: inset 0 0 0 1px rgba(120, 190, 240, 0.28);
}
/* 中心 + 四角微型螺丝 */
.tt-screw {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 10px;
  height: 10px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #586370, #12161a 80%);
  box-shadow: inset 0 0 0 1px rgba(190, 220, 245, 0.3);
}
.tt-screw.s2,
.tt-screw.s3,
.tt-screw.s4 {
  width: 4px;
  height: 4px;
}
.tt-screw.s2 {
  left: 22%;
  top: 26%;
}
.tt-screw.s3 {
  left: 78%;
  top: 30%;
}
.tt-screw.s4 {
  left: 50%;
  top: 78%;
}
/* 螺丝槽 */
.tt-screw::before,
.tt-screw::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  background: rgba(0, 0, 0, 0.75);
}
.tt-screw::before {
  width: 60%;
  height: 1px;
  transform: translate(-50%, -50%);
}
.tt-screw::after {
  width: 1px;
  height: 60%;
  transform: translate(-50%, -50%);
}

/* ---------- 臂杆：镂空框架 ---------- */
.tt-arm-rod {
  position: absolute;
  right: 1px;
  top: 0;
  width: 12px;
  height: 124px;
  /* 中间镂空：只剩左右两条梁，靠 clip-path 切出通透感 */
  background: linear-gradient(90deg, #7f8a95 0 2px, transparent 2px 10px, #4b545e 10px 12px);
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
}
/* 左右主梁（金属质感） */
.tt-rail {
  position: absolute;
  top: 0;
  width: 2.5px;
  height: 100%;
  border-radius: 1px;
}
.tt-rail.left {
  left: 0;
  background: linear-gradient(90deg, #b9c4ce, #6f7982);
}
.tt-rail.right {
  right: 0;
  background: linear-gradient(90deg, #6f7982, #333b43);
}
/* 横向加强筋 */
.tt-rib {
  position: absolute;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, #8f99a3, #4d565f);
  border-radius: 1px;
}
.tt-rib.r1 {
  top: 18%;
}
.tt-rib.r2 {
  top: 42%;
}
.tt-rib.r3 {
  top: 66%;
}
.tt-rib.r4 {
  top: 88%;
}
/* 中间一根细的信号走线（科技感点缀，克制） */
.tt-trace {
  position: absolute;
  left: 50%;
  top: 4px;
  width: 1px;
  height: calc(100% - 8px);
  transform: translateX(-50%);
  background: linear-gradient(180deg, transparent, rgba(96, 190, 255, 0.5) 30%, rgba(96, 190, 255, 0.5) 70%, transparent);
  opacity: 0.75;
}

/* 尾部配重：带镂空槽 */
.tt-counterweight {
  position: absolute;
  right: -6px;
  top: -26px;
  width: 20px;
  height: 24px;
  border-radius: 2px;
  background: linear-gradient(160deg, #4a525c 0%, #232a32 55%, #0d1116 100%);
  box-shadow:
    0 2px 7px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(160, 200, 230, 0.18);
}
.tt-cw-slot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 8px;
  height: 14px;
  transform: translate(-50%, -50%);
  border-radius: 1px;
  background: repeating-linear-gradient(
    180deg,
    rgba(0, 0, 0, 0.75) 0 2px,
    rgba(120, 150, 175, 0.25) 2px 3px
  );
}

/* ---------- 唱头：分段结构 ---------- */
.tt-arm-head {
  position: absolute;
  right: -5px;
  top: 118px;
  width: 22px;
  height: 20px;
}
.tt-head-cap {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 6px;
  border-radius: 1px 1px 0 0;
  background: linear-gradient(180deg, #dfe6ee, #9aa5b0 60%, #5d666f);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.3);
}
.tt-head-body {
  position: absolute;
  left: 0;
  right: 0;
  top: 6px;
  height: 10px;
  background:
    repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.35) 0 1px, transparent 1px 3px),
    linear-gradient(170deg, #3c454f, #14191f 75%);
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.55),
    inset 0 0 0 1px rgba(140, 185, 220, 0.2);
}
.tt-head-pin {
  position: absolute;
  left: 3px;
  right: 3px;
  bottom: 2px;
  height: 2px;
  border-radius: 1px;
  background: linear-gradient(90deg, transparent, rgba(96, 190, 255, 0.65), transparent);
}
/* 唱针：锥形金属针尖 */
.tt-needle {
  position: absolute;
  left: 50%;
  bottom: -8px;
  width: 2.5px;
  height: 10px;
  transform: translateX(-50%);
  background: linear-gradient(180deg, #eef4fa 0%, #aab4be 40%, #59616a 100%);
  clip-path: polygon(32% 0, 68% 0, 100% 100%, 0 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.7);
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
