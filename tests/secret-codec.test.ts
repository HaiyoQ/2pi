import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { createSecretCodec } from '../src/main/runtime/secret-codec'

describe('secret codec', () => {
  it('falls back to a user-local AES key when Electron safeStorage is unavailable', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'loop-secret-codec-'))
    const unavailable = {
      isEncryptionAvailable: () => false,
      encryptString: () => { throw new Error('must not use safeStorage') },
      decryptString: () => { throw new Error('must not use safeStorage') }
    }
    const codec = await createSecretCodec(userDataPath, unavailable)
    const encrypted = codec.encrypt('api-key-secret')

    expect(encrypted).toMatch(/^local-v1:/)
    expect(encrypted).not.toContain('api-key-secret')
    expect(codec.decrypt(encrypted)).toBe('api-key-secret')
    expect((await stat(join(userDataPath, 'secret.key'))).mode & 0o777).toBe(0o600)
    expect(await readFile(join(userDataPath, 'secret.key'))).toHaveLength(32)
  })

  it('prefers safeStorage and can still decrypt its legacy unprefixed values', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'loop-safe-storage-codec-'))
    const available = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`safe:${value}`),
      decryptString: (value: Buffer) => value.toString().replace(/^safe:/, '')
    }
    const codec = await createSecretCodec(userDataPath, available)
    const encrypted = codec.encrypt('api-key-secret')
    const legacy = Buffer.from('safe:legacy-key').toString('base64')

    expect(encrypted).toMatch(/^safe-v1:/)
    expect(codec.decrypt(encrypted)).toBe('api-key-secret')
    expect(codec.decrypt(legacy)).toBe('legacy-key')
  })

  it('keeps fallback-encrypted secrets readable after safeStorage becomes available', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'loop-secret-transition-'))
    const unavailable = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.alloc(0),
      decryptString: () => ''
    }
    const fallbackCodec = await createSecretCodec(userDataPath, unavailable)
    const encrypted = fallbackCodec.encrypt('fallback-secret')
    const available = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`safe:${value}`),
      decryptString: (value: Buffer) => value.toString().replace(/^safe:/, '')
    }

    const safeCodec = await createSecretCodec(userDataPath, available)
    expect(safeCodec.decrypt(encrypted)).toBe('fallback-secret')
  })
})
