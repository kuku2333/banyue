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
        <div class="tt-arm-base">
          <i class="tt-arm-ring" />
        </div>
        <div class="tt-arm-rod">
          <i class="tt-arm-glow" />
        </div>
        <div class="tt-arm-head">
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

/* ---------- 唱臂：硬盘磁头（楔形金属臂 + 读写头） ---------- */
.tt-arm {
  position: absolute;
  right: 10px;
  top: 12px;
  width: 14px;
  height: 14px;
  transform-origin: 50% 50%;
  transform: rotate(-32deg);
  transition: transform 0.55s cubic-bezier(0.25, 1.25, 0.45, 1);
  filter: drop-shadow(0 3px 8px rgba(0, 0, 0, 0.6));
}
.tt-arm.on {
  transform: rotate(16deg);
}

/* 转轴：硬盘的 pivot 轴承 */
.tt-arm-base {
  position: absolute;
  right: -11px;
  top: -11px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 36% 30%, #f6f9fb 0 10%, #c3ccd5 26%, #7d8791 52%, #333a42 80%, #171b20 100%);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.6),
    inset 0 0 0 1px rgba(255, 255, 255, 0.28),
    inset 0 -2px 6px rgba(0, 0, 0, 0.5);
}
/* 转轴中心的螺丝孔 */
.tt-arm-base::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 7px;
  height: 7px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 40% 35%, #2b323a, #0a0d10);
  box-shadow: inset 0 1px 2px rgba(255, 255, 255, 0.18);
}
.tt-arm-ring {
  position: absolute;
  inset: -6px;
  border-radius: 50%;
  border: 1px solid rgba(76, 194, 255, 0.5);
  box-shadow:
    0 0 10px rgba(76, 194, 255, 0.45),
    inset 0 0 8px rgba(76, 194, 255, 0.3);
}
.spinning .tt-arm-ring {
  animation: tt-ring-pulse 2.4s ease-in-out infinite;
}
@keyframes tt-ring-pulse {
  0%,
  100% {
    opacity: 0.4;
    box-shadow: 0 0 8px rgba(76, 194, 255, 0.3);
  }
  50% {
    opacity: 1;
    box-shadow: 0 0 18px rgba(76, 194, 255, 0.8);
  }
}

/* 臂杆：楔形金属臂（磁头悬臂），上宽下窄 */
.tt-arm-rod {
  position: absolute;
  right: -1px;
  top: 0;
  width: 13px;
  height: 124px;
  background: linear-gradient(100deg, #e8eef4 0%, #aab4bf 22%, #6f7a85 55%, #b9c3cd 78%, #5c656f 100%);
  clip-path: polygon(46% 0%, 54% 0%, 100% 88%, 100% 100%, 0% 100%, 0% 88%);
  box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.28);
}
/* 悬臂上的高光条 */
.tt-arm-glow {
  position: absolute;
  left: 50%;
  top: 6px;
  width: 2px;
  height: 100px;
  transform: translateX(-50%);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(124, 196, 255, 0.55) 45%, transparent 92%);
  opacity: 0.55;
}
.spinning .tt-arm-glow {
  animation: tt-glow-run 2.2s ease-in-out infinite;
}
@keyframes tt-glow-run {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 0.9;
  }
}

/* 读写头：末端的方块（slider + head） */
.tt-arm-head {
  position: absolute;
  right: -4px;
  top: 118px;
  width: 21px;
  height: 16px;
  border-radius: 3px;
  background: linear-gradient(165deg, #2f363f 0%, #12161b 55%, #05070a 100%);
  box-shadow:
    0 2px 9px rgba(0, 0, 0, 0.7),
    inset 0 0 0 1px rgba(150, 200, 240, 0.22),
    inset 0 -3px 6px rgba(0, 0, 0, 0.6);
}
/* 读写头上的感应点 */
.tt-arm-head::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 5px;
  height: 5px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(circle at 38% 34%, #d8f1ff, #4cc2ff 55%, #0d5f8a);
  box-shadow: 0 0 8px rgba(76, 194, 255, 0.9);
}
/* 磁针（贴近盘面的极细针脚） */
.tt-needle {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 1.5px;
  height: 8px;
  transform: translateX(-50%);
  border-radius: 1px;
  background: linear-gradient(180deg, #cfe9ff, #4cc2ff 55%, rgba(76, 194, 255, 0.1));
  box-shadow: 0 0 7px rgba(76, 194, 255, 0.85);
}
.spinning .tt-needle {
  animation: tt-needle-glow 1.6s ease-in-out infinite;
}
@keyframes tt-needle-glow {
  0%,
  100% {
    box-shadow: 0 0 5px rgba(76, 194, 255, 0.55);
  }
  50% {
    box-shadow: 0 0 15px rgba(150, 220, 255, 1);
  }
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
