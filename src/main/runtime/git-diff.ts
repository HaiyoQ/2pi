import { spawn } from 'node:child_process'
import type {
  GitChangedFile,
  GitChangeStatus,
  GitDiffSection,
  GitDiffSnapshot
} from '../../shared/contracts'

const STATUS_OUTPUT_LIMIT = 2 * 1024 * 1024
const DIFF_OUTPUT_LIMIT = 1024 * 1024
const MAX_FILES = 200
const COMMAND_TIMEOUT_MS = 10_000

export interface GitCommandResult {
  code: number
  stdout: string
  stderr: string
  truncated: boolean
  timedOut: boolean
}

export type GitRunner = (cwd: string, args: string[], outputLimit?: number) => Promise<GitCommandResult>

interface StatusEntry {
  index: string
  worktree: string
  path: string
  oldPath?: string
}

export async function getGitDiffSnapshot(workspacePath: string | undefined, runner: GitRunner = runGit): Promise<GitDiffSnapshot> {
  const generatedAt = new Date().toISOString()
  if (!workspacePath) return emptySnapshot(undefined, 'no-workspace', '请先选择工作目录', generatedAt)

  try {
    const repository = await runner(workspacePath, ['rev-parse', '--is-inside-work-tree'], 64 * 1024)
    if (repository.timedOut) return emptySnapshot(workspacePath, 'error', '检查 Git 仓库超时', generatedAt)
    if (repository.code !== 0 || repository.stdout.trim() !== 'true') {
      return emptySnapshot(workspacePath, 'not-git', '当前工作目录尚未初始化 Git 仓库', generatedAt)
    }

    const status = await runner(workspacePath, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], STATUS_OUTPUT_LIMIT)
    if (status.timedOut) return emptySnapshot(workspacePath, 'error', '读取 Git 改动超时', generatedAt)
    if (status.code !== 0) return emptySnapshot(workspacePath, 'error', commandMessage(status, '读取 Git 状态失败'), generatedAt)
    if (status.truncated) return emptySnapshot(workspacePath, 'error', 'Git 改动数量过多，无法完整读取文件清单', generatedAt)

    const allEntries = parsePorcelainStatus(status.stdout)
    const entries = allEntries.slice(0, MAX_FILES)
    const files: GitChangedFile[] = []
    let truncated = allEntries.length > entries.length
    for (const entry of entries) {
      const file = await loadChangedFile(workspacePath, entry, runner)
      files.push(file)
      truncated ||= file.sections.some((section) => section.truncated)
    }
    files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
    return {
      workspacePath,
      state: 'ready',
      message: files.length ? `检测到 ${files.length} 个改动文件` : '工作目录没有未提交改动',
      files,
      truncated,
      generatedAt
    }
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : ''
    if (code === 'ENOENT') return emptySnapshot(workspacePath, 'git-unavailable', '系统中未找到 Git，请先安装并加入 PATH', generatedAt)
    const message = error instanceof Error ? error.message : String(error)
    return emptySnapshot(workspacePath, 'error', `无法读取 Git 改动：${message}`, generatedAt)
  }
}

export function parsePorcelainStatus(output: string): StatusEntry[] {
  const records = output.split('\0')
  const entries: StatusEntry[] = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (!record || record.length < 4) continue
    const status = record.slice(0, 2)
    const path = record.slice(3)
    const renamed = status[0] === 'R' || status[0] === 'C' || status[1] === 'R' || status[1] === 'C'
    const oldPath = renamed ? records[++index] : undefined
    entries.push({ index: status[0], worktree: status[1], path, oldPath: oldPath || undefined })
  }
  return entries
}

export async function runGit(cwd: string, args: string[], outputLimit = DIFF_OUTPUT_LIMIT): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false
    let timedOut = false
    let settled = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, COMMAND_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdoutBytes >= outputLimit) {
        truncated = true
        return
      }
      const remaining = outputLimit - stdoutBytes
      const value = chunk.subarray(0, remaining)
      stdout.push(value)
      stdoutBytes += value.length
      if (value.length < chunk.length) truncated = true
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderrBytes >= 64 * 1024) return
      const value = chunk.subarray(0, 64 * 1024 - stderrBytes)
      stderr.push(value)
      stderrBytes += value.length
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        truncated,
        timedOut
      })
    })
  })
}

async function loadChangedFile(cwd: string, entry: StatusEntry, runner: GitRunner): Promise<GitChangedFile> {
  const sections: GitDiffSection[] = []
  const paths = entry.oldPath ? [entry.oldPath, entry.path] : [entry.path]
  if (entry.index !== ' ' && entry.index !== '?') {
    sections.push(await loadSection(cwd, 'staged', ['diff', '--cached', '--no-color', '--no-ext-diff', '--binary', '--find-renames', '--', ...paths], runner, [0]))
  }
  if (entry.worktree !== ' ' && entry.worktree !== '?') {
    sections.push(await loadSection(cwd, 'working', ['diff', '--no-color', '--no-ext-diff', '--binary', '--find-renames', '--', ...paths], runner, [0]))
  }
  if (entry.index === '?' && entry.worktree === '?') {
    sections.push(await loadSection(cwd, 'untracked', ['diff', '--no-index', '--no-color', '--no-ext-diff', '--binary', '--', '/dev/null', entry.path], runner, [0, 1]))
  }

  const combined = sections.map((section) => section.diff).join('\n')
  const counts = countChangedLines(combined)
  return {
    path: entry.path,
    oldPath: entry.oldPath,
    status: changeStatus(entry),
    staged: entry.index !== ' ' && entry.index !== '?',
    unstaged: entry.worktree !== ' ' || entry.index === '?',
    binary: /(^|\n)(GIT binary patch|Binary files )/.test(combined),
    additions: counts.additions,
    deletions: counts.deletions,
    sections
  }
}

async function loadSection(
  cwd: string,
  kind: GitDiffSection['kind'],
  args: string[],
  runner: GitRunner,
  acceptedCodes: number[]
): Promise<GitDiffSection> {
  const result = await runner(cwd, args, DIFF_OUTPUT_LIMIT)
  if (result.timedOut) throw new Error(`读取 ${kind} diff 超时`)
  if (!acceptedCodes.includes(result.code)) throw new Error(commandMessage(result, `读取 ${kind} diff 失败`))
  return { kind, diff: result.stdout, truncated: result.truncated }
}

function changeStatus(entry: StatusEntry): GitChangeStatus {
  const value = `${entry.index}${entry.worktree}`
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(value)) return 'conflicted'
  if (value.includes('R')) return 'renamed'
  if (value.includes('C')) return 'copied'
  if (value === '??') return 'untracked'
  if (value.includes('D')) return 'deleted'
  if (value.includes('A')) return 'added'
  return 'modified'
}

function countChangedLines(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions += 1
    else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1
  }
  return { additions, deletions }
}

function emptySnapshot(
  workspacePath: string | undefined,
  state: GitDiffSnapshot['state'],
  message: string,
  generatedAt: string
): GitDiffSnapshot {
  return { workspacePath, state, message, files: [], truncated: false, generatedAt }
}

function commandMessage(result: GitCommandResult, fallback: string): string {
  const detail = result.stderr.trim().split(/\r?\n/)[0]
  return detail ? `${fallback}：${detail}` : fallback
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
