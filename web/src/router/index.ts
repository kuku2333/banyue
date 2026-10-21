import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

const routes: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView, meta: { title: '半页 · 生活随笔与读书笔记' } },
  {
    path: '/post/:slug',
    name: 'post',
    component: () => import('@/views/PostView.vue'),
  },
  { path: '/tags', name: 'tags', component: () => import('@/views/TagsView.vue'), meta: { title: '标签 · 半页' } },
  { path: '/shelf', name: 'shelf', component: () => import('@/views/ShelfView.vue'), meta: { title: '书架 · 半页' } },
  {
    path: '/read/:id',
    name: 'read',
    component: () => import('@/views/ReaderView.vue'),
    meta: { title: '阅读 · 半页' },
  },
  { path: '/music', name: 'music', component: () => import('@/views/MusicView.vue'), meta: { title: '听歌 · 半页' } },
  {
    path: '/tag/:tag',
    name: 'tag',
    component: () => import('@/views/TagView.vue'),
  },
  {
    path: '/archive',
    name: 'archive',
    component: () => import('@/views/ArchiveView.vue'),
    meta: { title: '归档 · 半页' },
  },
  { path: '/about', name: 'about', component: () => import('@/views/AboutView.vue'), meta: { title: '关于 · 半页' } },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFoundView.vue'),
    meta: { title: '找不到这一页 · 半页' },
  },
]

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition
    if (to.hash) return { el: to.hash, top: 96, behavior: 'smooth' }
    return { top: 0 }
  },
})

router.afterEach((to) => {
  const title = to.meta.title as string | undefined
  document.title = title ?? '半页'
})
