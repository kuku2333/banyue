<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { usePlayerStore } from '@/stores/player'
import {
  addPlaylistItem,
  createPlaylist,
  listPlaylists,
  type PlaylistSummary,
} from '@/lib/playlists'

/** 选歌单：把当前这首加进哪个歌单（含自动创建的「我喜欢的音乐」） */
const props = defineProps<{
  open: boolean
  trackTitle: string
  trackArtist?: string
  trackHash?: string
  trackAssetId?: string
}>()
const emit = defineEmits<{ 'update:open': [value: boolean] }>()

const auth = useAuthStore()
const player = usePlayerStore()

const mine = ref<PlaylistSummary[]>([])
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const message = ref('')
const creating = ref(false)
const newName = ref('')

const alreadyFav = computed(() => {
  const key = props.trackHash || props.trackAssetId || props.trackTitle
  return player.isFavorite(key) || (player.current ? player.isFavorite(player.current.id) : false)
})

async function load(): Promise<void> {
  if (!auth.loggedIn) return
  loading.value = true
  error.value = ''
  try {
    const data = await listPlaylists()
    mine.value = data.playlists.filter((item) => item.mine)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      message.value = ''
      error.value = ''
      creating.value = false
      newName.value = ''
      if (!auth.loggedIn) auth.openDialog()
      else void load()
    }
  },
)

async function addTo(playlistId: string): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await addPlaylistItem(playlistId, {
      title: props.trackTitle,
      artist: props.trackArtist ?? '',
      key: props.trackHash || props.trackAssetId || props.trackTitle,
      hash: props.trackHash ?? '',
      assetId: props.trackAssetId ?? '',
    })
    message.value = '已加入歌单'
    setTimeout(() => emit('update:open', false), 700)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

/** 默认动作：加入「收藏」（音乐页的收藏标签，不用另建歌单） */
function addToFavorites(): void {
  const track = player.current
  const target =
    track && track.title === props.trackTitle
      ? track
      : {
          id: props.trackHash || props.trackAssetId || props.trackTitle,
          title: props.trackTitle,
          artist: props.trackArtist ?? '',
          source: 'local' as const,
          hash: props.trackHash,
        }
  if (player.isFavorite(target.id)) {
    message.value = '已经在收藏里了'
    setTimeout(() => emit('update:open', false), 700)
    return
  }
  player.toggleFavorite(target)
  message.value = '已加入收藏'
  setTimeout(() => emit('update:open', false), 700)
}

async function submitCreate(): Promise<void> {
  const name = newName.value.trim()
  if (!name) return
  busy.value = true
  error.value = ''
  try {
    const id = await createPlaylist({ name })
    newName.value = ''
    creating.value = false
    await load()
    await addTo(id)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    busy.value = false
  }
}

function close(): void {
  emit('update:open', false)
}
</script>

<template>
  <Transition name="auth">
    <div v-if="props.open" class="auth-layer" role="dialog" aria-modal="true" aria-label="加入歌单" @click.self="close">
      <div class="auth-box">
        <header>
          <h2>加入歌单</h2>
          <button type="button" class="close" aria-label="关闭" @click="close">×</button>
        </header>

        <p class="lead">
          {{ props.trackTitle }}
          <span v-if="props.trackArtist"> · {{ props.trackArtist }}</span>
        </p>

        <p v-if="!auth.loggedIn" class="muted">歌单存在云端，先登录才能加进去。</p>

        <template v-else>
          <button type="button" class="fav" :disabled="alreadyFav" @click="addToFavorites">
            {{ alreadyFav ? '♥ 已在收藏里' : '♥ 加入收藏' }}
          </button>

          <p v-if="loading" class="muted small">加载歌单…</p>
          <ul v-else class="pl-list">
            <li v-for="item in mine" :key="item.id">
              <button type="button" class="pl-item" :disabled="busy" @click="addTo(item.id)">
                <b>{{ item.name }}</b>
                <span>{{ item.itemCount }} 首</span>
              </button>
            </li>
          </ul>

          <form v-if="creating" class="create" @submit.prevent="submitCreate">
            <input v-model="newName" placeholder="新歌单名" maxlength="60" required />
            <button type="submit" class="btn" :disabled="busy || !newName.trim()">创建并加入</button>
          </form>
          <button v-else type="button" class="new-btn" @click="creating = true">＋ 新建歌单</button>
        </template>

        <p v-if="message" class="ok">{{ message }}</p>
        <p v-if="error" class="err">{{ error }}</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.auth-layer {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(4, 8, 12, 0.66);
}
.auth-box {
  width: min(400px, 100%);
  max-height: min(76vh, 600px);
  overflow: auto;
  padding: 18px;
  border: 1px solid #2b3642;
  border-radius: 14px;
  background: #141b23;
  color: #e7edf2;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}
.auth-box header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.auth-box h2 {
  margin: 0;
  font-size: 1.05rem;
}
.close {
  border: none;
  background: none;
  color: inherit;
  font-size: 1.3rem;
  cursor: pointer;
  opacity: 0.6;
}
.lead {
  margin: 8px 0 14px;
  font-size: 0.85rem;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fav {
  width: 100%;
  padding: 10px;
  margin-bottom: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 94, 120, 0.45);
  background: rgba(255, 94, 120, 0.12);
  color: #ff8fa3;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
}
.fav:disabled {
  opacity: 0.5;
}
.pl-list {
  margin: 0 0 12px;
  padding: 0;
  list-style: none;
}
.pl-list li + li {
  margin-top: 6px;
}
.pl-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border: 1px solid #2b3642;
  border-radius: 10px;
  background: #1a222b;
  color: inherit;
  cursor: pointer;
  text-align: left;
}
.pl-item:hover {
  border-color: rgba(124, 196, 255, 0.5);
}
.pl-item b {
  font-weight: 500;
  font-size: 0.88rem;
}
.pl-item span {
  font-size: 0.74rem;
  opacity: 0.6;
}
.create {
  display: flex;
  gap: 8px;
}
.create input {
  flex: 1;
  min-height: 38px;
  padding: 8px 12px;
  border-radius: 8px;
  border: 1px solid #2b3642;
  background: #0d1319;
  color: #e7edf2;
}
.new-btn {
  width: 100%;
  padding: 9px;
  border: 1px dashed #2b3642;
  border-radius: 10px;
  background: none;
  color: #7cc4ff;
  cursor: pointer;
}
.muted {
  opacity: 0.65;
  font-size: 0.85rem;
}
.ok {
  margin: 10px 0 0;
  color: #58d68d;
  font-size: 0.84rem;
}
.err {
  margin: 10px 0 0;
  color: #ff7b72;
  font-size: 0.84rem;
}
</style>
