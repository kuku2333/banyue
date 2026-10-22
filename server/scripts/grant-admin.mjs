// 用法：node scripts/grant-admin.mjs <username> [--revoke]
// 也可以在启动服务时用 BANYUE_ADMINS=alice,bob 指定管理员
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

const username = process.argv[2]?.trim().toLowerCase()
const revoke = process.argv.includes('--revoke')

if (!username) {
  console.error('用法: node scripts/grant-admin.mjs <username> [--revoke]')
  process.exit(1)
}

const dbPath = process.env.BANYUE_DB ?? resolve('data/banyue.db')
const db = new DatabaseSync(dbPath)
const value = revoke ? 0 : 1
const info = db.prepare('UPDATE users SET is_admin = ? WHERE username = ?').run(value, username)

if (info.changes === 0) {
  console.error(`找不到用户 ${username}（数据库：${dbPath}）`)
  process.exit(1)
}
console.log(`${revoke ? '已取消' : '已设置'} ${username} 的管理员权限（数据库：${dbPath}）`)
