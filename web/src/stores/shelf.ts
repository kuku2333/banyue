import { defineStore } from 'pinia'
import { ref } from 'vue'
import { cleanBookText, countWords, decodeText, parseBookMeta, splitChapters } from '@/lib/books'
import { deleteBook, listBooks, putBook, type BookRecord } from '@/lib/db'

export interface ImportResult {
  added: number
  skipped: number
  failed: { name: string; reason: string }[]
}

export const useShelfStore = defineStore('shelf', () => {
  const books = ref<BookRecord[]>([])
  const loading = ref(false)
  const importing = ref(false)

  async function refresh(): Promise<void> {
    loading.value = true
    try {
      books.value = await listBooks()
    } finally {
      loading.value = false
    }
  }

  async function importFiles(files: File[]): Promise<ImportResult> {
    const result: ImportResult = { added: 0, skipped: 0, failed: [] }
    importing.value = true
    try {
      for (const file of files) {
        const isText = /\.(txt|md|markdown)$/i.test(file.name)
        if (!isText) {
          result.failed.push({ name: file.name, reason: '只支持 TXT / Markdown' })
          continue
        }
        try {
          const buffer = await file.arrayBuffer()
          const { text: raw, encoding } = decodeText(buffer)
          const cleaned = cleanBookText(raw)
          if (!cleaned) {
            result.failed.push({ name: file.name, reason: '文件是空的' })
            continue
          }
          const meta = parseBookMeta(file.name, raw)
          const chapters = splitChapters(cleaned)
          const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

          await putBook(
            {
              id,
              title: meta.title,
              author: meta.author,
              format: /\.md$/i.test(file.name) ? 'md' : 'txt',
              size: file.size,
              words: countWords(cleaned),
              chapterCount: chapters.length,
              encoding,
              createdAt: Date.now(),
              progress: 0,
            },
            chapters,
          )
          result.added++
        } catch (error) {
          result.failed.push({ name: file.name, reason: (error as Error).message })
        }
      }
      await refresh()
      return result
    } finally {
      importing.value = false
    }
  }

  async function remove(id: string): Promise<void> {
    await deleteBook(id)
    await refresh()
  }

  return { books, loading, importing, refresh, importFiles, remove }
})
