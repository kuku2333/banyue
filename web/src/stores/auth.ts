import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { api, type PublicUser } from '@/lib/api'

export const useAuthStore = defineStore('auth', () => {
  const user = ref<PublicUser | null>(null)
  const ready = ref(false)
  const dialogOpen = ref(false)

  const loggedIn = computed(() => Boolean(user.value))

  async function ensure(): Promise<void> {
    if (ready.value) return
    try {
      const data = await api<{ user: PublicUser | null }>('/api/me')
      user.value = data.user
    } catch {
      user.value = null
    } finally {
      ready.value = true
    }
  }

  async function login(username: string, password: string): Promise<void> {
    const data = await api<{ user: PublicUser }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    user.value = data.user
    ready.value = true
  }

  async function register(username: string, password: string, displayName: string): Promise<void> {
    const data = await api<{ user: PublicUser }>('/api/auth/register', {
      method: 'POST',
      body: { username, password, displayName },
    })
    user.value = data.user
    ready.value = true
  }

  async function logout(): Promise<void> {
    await api('/api/auth/logout', { method: 'POST' })
    user.value = null
  }

  function openDialog(): void {
    dialogOpen.value = true
  }

  return { user, ready, loggedIn, dialogOpen, ensure, login, register, logout, openDialog }
})
