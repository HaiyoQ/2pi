import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { SecretCodec } from './settings-store'

const LOCAL_PREFIX = 'local-v1:'
const SAFE_PREFIX = 'safe-v1:'

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export async function createSecretCodec(userDataPath: string, safeStorage: SafeStorageAdapter): Promise<SecretCodec> {
  const localKeyPath = join(userDataPath, 'secret.key')
  if (safeStorage.isEncryptionAvailable()) {
    const localKey = await loadLocalKey(localKeyPath)
    return {
      encrypt: (value) => `${SAFE_PREFIX}${safeStorage.encryptString(value).toString('base64')}`,
      decrypt(value) {
        if (value.startsWith(LOCAL_PREFIX)) {
          if (!localKey) throw new Error('找不到本地后备密钥')
          return decryptLocal(value, localKey)
        }
        return safeStorage.decryptString(Buffer.from(stripPrefix(value, SAFE_PREFIX), 'base64'))
      }
    }
  }

  const key = await loadOrCreateLocalKey(localKeyPath)
  return {
    encrypt: (value) => encryptLocal(value, key),
    decrypt(value) {
      if (!value.startsWith(LOCAL_PREFIX)) {
        throw new Error('现有密钥由系统安全存储加密，但当前系统安全存储不可用')
      }
      return decryptLocal(value, key)
    }
  }
}

function encryptLocal(value: string, key: Buffer): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${LOCAL_PREFIX}${Buffer.concat([nonce, tag, ciphertext]).toString('base64')}`
}

function decryptLocal(value: string, key: Buffer): string {
  const payload = Buffer.from(value.slice(LOCAL_PREFIX.length), 'base64')
  if (payload.length < 29) throw new Error('本地加密数据无效')
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12))
  decipher.setAuthTag(payload.subarray(12, 28))
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8')
}

async function loadLocalKey(path: string): Promise<Buffer | undefined> {
  try {
    const key = await readFile(path)
    if (key.length !== 32) throw new Error('本地密钥文件长度无效')
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

async function loadOrCreateLocalKey(path: string): Promise<Buffer> {
  try {
    const key = await readFile(path)
    if (key.length !== 32) throw new Error('本地密钥文件长度无效')
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  await mkdir(dirname(path), { recursive: true })
  const key = randomBytes(32)
  try {
    await writeFile(path, key, { flag: 'wx', mode: 0o600 })
    return key
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(path)
    if (existing.length !== 32) throw new Error('本地密钥文件长度无效')
    return existing
  }
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}
