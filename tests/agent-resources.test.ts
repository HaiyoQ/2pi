import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAgentResources, updateProjectTrust } from '../src/main/runtime/agent-resources'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture(): Promise<{ root: string; cwd: string; agentDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'loop-resources-'))
  temporaryPaths.push(root)
  const cwd = join(root, 'project')
  const agentDir = join(root, 'user-data', 'agent')
  await Promise.all([
    mkdir(join(cwd, '.pi', 'skills', 'project-skill'), { recursive: true }),
    mkdir(join(agentDir, 'skills', 'user-skill'), { recursive: true })
  ])
  await writeFile(join(cwd, '.pi', 'skills', 'project-skill', 'SKILL.md'), '---\nname: project-skill\ndescription: 项目技能\n---\n项目内容\n')
  await writeFile(join(agentDir, 'skills', 'user-skill', 'SKILL.md'), '---\nname: user-skill\ndescription: 用户技能\n---\n用户内容\n')
  return { root, cwd, agentDir }
}

describe('Agent resources', () => {
  it('loads user resources but gates project resources until the path is trusted', async () => {
    const { cwd, agentDir } = await fixture()

    const untrusted = await loadAgentResources({ cwd, agentDir })
    expect(untrusted.snapshot.trust).toMatchObject({ required: true, decision: 'unset' })
    expect(untrusted.snapshot.resources.map((item) => item.name)).toContain('user-skill')
    expect(untrusted.snapshot.resources.map((item) => item.name)).not.toContain('project-skill')

    updateProjectTrust(cwd, agentDir, true)
    const trusted = await loadAgentResources({ cwd, agentDir })
    expect(trusted.snapshot.trust.decision).toBe('trusted')
    expect(trusted.snapshot.resources.map((item) => item.name)).toEqual(expect.arrayContaining(['user-skill', 'project-skill']))
  })

  it('reports invalid executable extensions without failing the resource snapshot', async () => {
    const { cwd, agentDir } = await fixture()
    const extensionDir = join(cwd, '.pi', 'extensions')
    await mkdir(extensionDir, { recursive: true })
    await writeFile(join(extensionDir, 'broken.ts'), 'export default function ( {')
    updateProjectTrust(cwd, agentDir, true)

    const state = await loadAgentResources({ cwd, agentDir })

    expect(state.loader).toBeDefined()
    expect(state.snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'error', path: expect.stringContaining('broken.ts') })
    ]))
  })
})
