import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { getGitDiffSnapshot, parsePorcelainStatus } from '../src/main/runtime/git-diff'

const execute = promisify(execFile)
const tempPaths: string[] = []

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('Git diff 审阅', () => {
  it('解析 NUL 分隔的重命名和未跟踪路径', () => {
    expect(parsePorcelainStatus('R  new name.ts\0old name.ts\0?? loose file.ts\0')).toEqual([
      { index: 'R', worktree: ' ', path: 'new name.ts', oldPath: 'old name.ts' },
      { index: '?', worktree: '?', path: 'loose file.ts', oldPath: undefined }
    ])
  })

  it('按文件返回暂存、未暂存和未跟踪 diff', async () => {
    const cwd = await temporaryDirectory('2pi-git-')
    await execute('git', ['init'], { cwd })
    await writeFile(join(cwd, 'tracked file.txt'), 'staged line\n')
    await execute('git', ['add', '--', 'tracked file.txt'], { cwd })
    await writeFile(join(cwd, 'tracked file.txt'), 'staged line\nworking line\n')
    await writeFile(join(cwd, 'loose file.txt'), 'untracked line\n')

    const snapshot = await getGitDiffSnapshot(cwd)
    const tracked = snapshot.files.find((file) => file.path === 'tracked file.txt')
    const untracked = snapshot.files.find((file) => file.path === 'loose file.txt')

    expect(snapshot).toMatchObject({ state: 'ready', truncated: false })
    expect(tracked).toMatchObject({ status: 'added', staged: true, unstaged: true })
    expect(tracked?.sections.map((section) => section.kind)).toEqual(['staged', 'working'])
    expect(untracked).toMatchObject({ status: 'untracked', staged: false, unstaged: true })
    expect(untracked?.sections[0].diff).toContain('untracked line')
  })

  it('为未初始化 Git 的目录返回明确空状态', async () => {
    const cwd = await temporaryDirectory('2pi-no-git-')
    await expect(getGitDiffSnapshot(cwd)).resolves.toMatchObject({
      state: 'not-git', files: [], message: '当前工作目录尚未初始化 Git 仓库'
    })
  })
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  tempPaths.push(path)
  return path
}
