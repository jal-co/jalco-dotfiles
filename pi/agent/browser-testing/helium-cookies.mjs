import { createDecipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const HELIUM_COOKIES = join(homedir(), 'Library/Application Support/net.imput.helium/Default/Cookies')
const CHROMIUM_EPOCH_OFFSET_SECONDS = 11644473600
const SAME_SITE = { 0: 'None', 1: 'Lax', 2: 'Strict' }

export function cookieKey(password) {
  return pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1')
}

export function decryptCookie(encrypted, key, hostKey, dbVersion) {
  if (encrypted.subarray(0, 3).toString() !== 'v10') throw new Error(`Unsupported cookie encryption for ${hostKey}`)
  const decipher = createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
  let plain = Buffer.concat([decipher.update(encrypted.subarray(3)), decipher.final()])
  if (dbVersion >= 24) {
    const digest = createHash('sha256').update(hostKey).digest()
    if (!plain.subarray(0, 32).equals(digest)) throw new Error(`Cookie integrity check failed for ${hostKey}`)
    plain = plain.subarray(32)
  }
  return plain.toString('utf8')
}

export function matchesDomain(hostKey, domains) {
  const host = hostKey.replace(/^\./, '')
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`))
}

export function toStorageState(rows, domains, key, dbVersion) {
  const cookies = rows
    .filter(row => matchesDomain(row.host_key, domains))
    .map(row => ({
      name: row.name,
      value: row.value || decryptCookie(Buffer.from(row.encrypted_value), key, row.host_key, dbVersion),
      domain: row.host_key,
      path: row.path,
      expires: Number(row.expires_utc) === 0 ? -1 : Math.floor(Number(row.expires_utc) / 1e6 - CHROMIUM_EPOCH_OFFSET_SECONDS),
      httpOnly: Boolean(row.is_httponly),
      secure: Boolean(row.is_secure),
      sameSite: SAME_SITE[row.samesite] ?? 'Lax',
    }))
  return { cookies, origins: [] }
}

export function readHeliumState(domains) {
  if (!domains.length) throw new Error('Name at least one domain to import, for example localhost or mastra.ai')
  const password = execFileSync('security', ['find-generic-password', '-w', '-s', 'Helium Storage Key', '-a', 'Helium'], { encoding: 'utf8' }).trim()
  const dir = mkdtempSync(join(tmpdir(), 'helium-cookies-'))
  try {
    const copy = join(dir, 'Cookies')
    copyFileSync(HELIUM_COOKIES, copy)
    const db = new DatabaseSync(copy, { readOnly: true })
    const dbVersion = Number(db.prepare("select value from meta where key = 'version'").get().value)
    const query = db.prepare('select host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite from cookies')
    query.setReadBigInts(true)
    const rows = query.all()
    db.close()
    return toStorageState(rows, domains, cookieKey(password), dbVersion)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
