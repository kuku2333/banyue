// 一次性/可重复迁移：
// 1. 给所有无指纹的云端资产回填内容指纹（SHA-256 前 16 位，与前端一致）
// 2. 按 (owner, kind, hash) 找重复，保留最早一条，删掉多余的（库记录 + 磁盘文件）
// 3. 清理磁盘上库里没有的孤儿文件（如测试残留的 .html）
//
// 用法：node scripts/backfill-hash.mjs
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, unlinkSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DB_PATH = process.env.BANYUE_DB ?? resolve('data/banyue.db')
const FILES_DIR = process.env.BANYUE_FILES_DIR ?? resolve('data/files')

const db = new DatabaseSync(DB_PATH)

function hash16(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex').slice(0, 16)
}

const assets = db.prepare('SELECT id, owner_id, kind, stored_name, hash, created_at FROM assets').all()

// 1) 回填指纹
let backfilled = 0
for (const asset of assets) {
  if (asset.hash) continue
  const file = join(FILES_DIR, asset.stored_name)
  if (!existsSync(file)) {
    console.warn(`[跳过] ${asset.id} 磁盘文件缺失: ${asset.stored_name}`)
    continue
  }
  const hash = hash16(file)
  db.prepare('UPDATE assets SET hash = ? WHERE id = ?').run(hash, asset.id)
  asset.hash = hash
  backfilled++
}
console.log(`回填指纹：${backfilled} 条`)

// 2) 找重复：同 owner + kind + hash，保留 created_at 最早（同刻保留 id 最小）的那条
const seen = new Map()
const dups = []
for (const asset of assets) {
  if (!asset.hash) continue
  const key = `${asset.owner_id}|${asset.kind}|${asset.hash}`
  const prev = seen.get(key)
  if (!prev) {
    seen.set(key, asset)
    continue
  }
  // 谁更早保留谁；更晚的那条进删除名单
  const keepOlder = prev.created_at <= asset.created_at
  const [keeper, victim] = keepOlder ? [prev, asset] : [asset, prev]
  if (!keepOlder) seen.set(key, asset)
  dups.push({ victim, keeper })
}

let freed = 0
let deleted = 0
for (const { victim, keeper } of dups) {
  const file = join(FILES_DIR, victim.stored_name)
  if (existsSync(file)) {
    try {
      unlinkSync(file)
      freed += 1
    } catch (error) {
      console.warn(`[删除文件失败] ${victim.stored_name}: ${error.message}`)
      continue
    }
  }
  db.prepare('DELETE FROM assets WHERE id = ?').run(victim.id)
  deleted++
  console.log(`删除重复：${victim.id} ${victim.stored_name}（保留 ${keeper.id}）`)
}
console.log(`删除重复：${deleted} 条，释放文件 ${freed} 个`)

// 3) 清理磁盘孤儿
const inDb = new Set(assets.map((asset) => asset.stored_name))
let orphans = 0
for (const name of readdirSync(FILES_DIR)) {
  if (name.endsWith('.part')) continue
  if (!inDb.has(name)) {
    try {
      unlinkSync(join(FILES_DIR, name))
      orphans++
      console.log(`清理孤儿文件：${name}`)
    } catch (error) {
      console.warn(`[清理失败] ${name}: ${error.message}`)
    }
  }
}
console.log(`清理孤儿文件：${orphans} 个`)

// 汇总
const remaining = db.prepare('SELECT COALESCE(SUM(size), 0) AS total, COUNT(*) AS count FROM assets').get()
console.log(`\n完成。当前云端：${remaining.count} 条，${(remaining.total / 1048576).toFixed(2)} MB`)
