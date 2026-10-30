#!/usr/bin/env node
/**
 * prune-cookies.mjs — 一次性清理 DSH 桌面端累积的 dsh-auth-* cookie。
 *
 * 适用场景：已经出现 "Web authentication failed" / "HTTP 431"，
 * 或想在不安装插件的情况下先把历史 cookie 清掉。
 *
 * 用法（必须先完全退出 DeepSeek Harness，Windows 托盘也要退出）：
 *   node tools/prune-cookies.mjs            # 只清理，自动备份
 *   node tools/prune-cookies.mjs --dry-run  # 只统计，不删除
 *   node tools/prune-cookies.mjs --db <path> # 指定 Cookies 数据库路径
 *
 * 依赖 Node.js >= 22.5（内置 node:sqlite）。
 */

import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const dbIndex = args.indexOf('--db')
const defaultDb = path.join(
  process.env.APPDATA ?? path.join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
  '@deepseek-ai',
  'dsh-desktop',
  'Network',
  'Cookies',
)
const dbPath = dbIndex >= 0 ? args[dbIndex + 1] : defaultDb

if (!fs.existsSync(dbPath)) {
  console.error(`[cookie-guard] 找不到 Cookies 数据库：${dbPath}`)
  console.error('[cookie-guard] 请先启动过一次 DSH，或用 --db 指定路径。')
  process.exit(1)
}

const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/, 'Z')
const backupPath = `${dbPath}.bak-${stamp}`
if (!dryRun) fs.copyFileSync(dbPath, backupPath)

const db = new DatabaseSync(dbPath)

const before = db.prepare("select count(*) as c from cookies where name like 'dsh-auth-%'").get().c
const total = db.prepare('select count(*) as c from cookies').get().c

console.log(`[cookie-guard] 数据库：${dbPath}`)
console.log(`[cookie-guard] dsh-auth-* 条数：${before} / 全部 cookie：${total}`)

if (before === 0) {
  console.log('[cookie-guard] 无需清理。')
  db.close()
  process.exit(0)
}

if (dryRun) {
  console.log('[cookie-guard] --dry-run：未删除任何数据。')
  db.close()
  process.exit(0)
}

db.exec("delete from cookies where name like 'dsh-auth-%'")
db.exec('pragma wal_checkpoint(truncate)')

const after = db.prepare("select count(*) as c from cookies where name like 'dsh-auth-%'").get().c
console.log(`[cookie-guard] 已删除 ${before - after} 条；现在剩余 ${after} 条。`)
console.log(`[cookie-guard] 备份：${backupPath}`)
db.close()
