import { describe, expect, it } from 'vitest'
import { createWebPreferences } from '../src/main/window-options'

describe('Electron preload 配置', () => {
  it('关闭默认 sandbox，使 ESM preload 能执行并注入桥接', () => {
    expect(createWebPreferences('out/preload/index.mjs')).toMatchObject({
      preload: 'out/preload/index.mjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    })
  })
})
