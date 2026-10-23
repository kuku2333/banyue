import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dbPath = process.env.BANYUE_DB ?? resolve(root, 'data/banyue.db')
mkdirSync(dirname(dbPath), { recursive: true })

export const db = new DatabaseSync(dbPath)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('music','books')),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS collection_items (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE (collection_id, item_key)
  );

  /* 歌单：公开的歌单所有人都能看到；is_public=0 只有自己可见 */
  CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    is_public INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS playlist_items (
    id TEXT PRIMARY KEY,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    item_key TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    asset_id TEXT NOT NULL DEFAULT '',
    hash TEXT NOT NULL DEFAULT '',
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE (playlist_id, item_key)
  );

  /* 别人可以选择隐藏某个公开歌单（只影响自己的列表） */
  CREATE TABLE IF NOT EXISTS playlist_hides (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, playlist_id)
  );

  CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    book_key TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chapter INTEGER NOT NULL,
    chapter_title TEXT NOT NULL DEFAULT '',
    ratio REAL NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS song_comments (
    id TEXT PRIMARY KEY,
    song_key TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS paragraph_comments (
    id TEXT PRIMARY KEY,
    book_key TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    paragraph INTEGER NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_items_collection ON collection_items(collection_id);
  CREATE INDEX IF NOT EXISTS idx_bookmarks_book ON bookmarks(book_key);
  CREATE INDEX IF NOT EXISTS idx_comments_song ON song_comments(song_key);
  CREATE INDEX IF NOT EXISTS idx_pc_book_chapter ON paragraph_comments(book_key, chapter);
  CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists(owner_id);
  CREATE INDEX IF NOT EXISTS idx_playlist_items_pl ON playlist_items(playlist_id, position);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('book','track')),
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    size INTEGER NOT NULL,
    mime TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    hash TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind, created_at);

  CREATE TABLE IF NOT EXISTS hidden_posts (
    slug TEXT PRIMARY KEY,
    hidden_by TEXT NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    hidden_at INTEGER NOT NULL
  );
`)

/* 老库补列：恢复码 / 管理员 */
const userColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((column) => column.name))
if (!userColumns.has('recovery_hash')) {
  db.exec('ALTER TABLE users ADD COLUMN recovery_hash TEXT')
}
if (!userColumns.has('recovery_salt')) {
  db.exec('ALTER TABLE users ADD COLUMN recovery_salt TEXT')
}
if (!userColumns.has('is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0')
}

/* 老库补列：云端文件指纹（判重用，旧数据为空） */
const assetColumns = new Set(db.prepare('PRAGMA table_info(assets)').all().map((column) => column.name))
if (!assetColumns.has('hash')) {
  db.exec('ALTER TABLE assets ADD COLUMN hash TEXT NOT NULL DEFAULT \'\'')
}
db.exec('CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(owner_id, kind, hash)')

/* 环境变量里列出的用户名自动成为管理员 */
const admins = (process.env.BANYUE_ADMINS ?? '')
  .split(',')
  .map((name) => name.trim().toLowerCase())
  .filter(Boolean)
for (const username of admins) {
  db.prepare('UPDATE users SET is_admin = 1 WHERE username = ?').run(username)
}

export function rows(sql, params = []) {
  return db.prepare(sql).all(...params)
}

export function row(sql, params = []) {
  return db.prepare(sql).get(...params)
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params)
}

export function transaction(fn) {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
