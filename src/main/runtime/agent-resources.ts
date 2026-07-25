import { basename, join, relative, resolve } from 'node:path'
import {
  DefaultResourceLoader,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
  type ResourceDiagnostic
} from '@earendil-works/pi-coding-agent'
import type {
  AgentResourceDiagnostic,
  AgentResourceItem,
  AgentResourcesSnapshot,
  ProjectResourceTrust
} from '../../shared/contracts'
import { friendlyError } from './validation'

export interface AgentResourceState {
  loader: DefaultResourceLoader
  settingsManager: SettingsManager
  snapshot: AgentResourcesSnapshot
  options: LoadAgentResourcesOptions
  trust: ProjectResourceTrust
  extraDiagnostics: AgentResourceDiagnostic[]
}

export interface LoadAgentResourcesOptions {
  cwd: string
  agentDir: string
  appendSystemPrompt?: string[]
}

export async function loadAgentResources(options: LoadAgentResourcesOptions): Promise<AgentResourceState> {
  const extraDiagnostics: AgentResourceDiagnostic[] = []
  const trust = readProjectTrust(options.cwd, options.agentDir, extraDiagnostics)
  let settingsManager = loaderSettings(options, trust.decision === 'trusted')
  let loader = createLoader(options, settingsManager)

  try {
    await loader.reload()
  } catch (error) {
    extraDiagnostics.push({
      id: 'resource-loader:fallback',
      severity: 'error',
      message: `资源加载失败，已停用扩展并继续启动基础会话：${friendlyError(error)}`
    })
    settingsManager = loaderSettings(options, false)
    loader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: options.agentDir,
      settingsManager,
      appendSystemPrompt: options.appendSystemPrompt,
      noExtensions: true
    })
    try {
      await loader.reload()
    } catch (fallbackError) {
      extraDiagnostics.push({
        id: 'resource-loader:empty-fallback',
        severity: 'error',
        message: `Markdown 资源也无法加载，基础会话将不使用外部资源：${friendlyError(fallbackError)}`
      })
      settingsManager = SettingsManager.inMemory({}, { projectTrusted: false })
      loader = new DefaultResourceLoader({
        cwd: options.cwd,
        agentDir: options.agentDir,
        settingsManager,
        appendSystemPrompt: options.appendSystemPrompt,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true
      })
      await loader.reload()
    }
  }

  for (const item of settingsManager.drainErrors()) {
    extraDiagnostics.push({
      id: `settings:${item.scope}:${extraDiagnostics.length}`,
      severity: 'error',
      message: `${item.scope === 'project' ? '项目' : '用户'}资源设置无效：${friendlyError(item.error)}`
    })
  }

  return { loader, settingsManager, snapshot: buildResourceSnapshot(loader, options, trust, extraDiagnostics), options, trust, extraDiagnostics }
}

export function refreshAgentResourceSnapshot(state: AgentResourceState): AgentResourcesSnapshot {
  state.snapshot = buildResourceSnapshot(state.loader, state.options, state.trust, state.extraDiagnostics)
  return state.snapshot
}

export function updateProjectTrust(cwd: string, agentDir: string, trusted: boolean): void {
  new ProjectTrustStore(agentDir).set(cwd, trusted)
}

function loaderSettings(options: LoadAgentResourcesOptions, projectTrusted: boolean): SettingsManager {
  return SettingsManager.create(options.cwd, options.agentDir, { projectTrusted })
}

function createLoader(options: LoadAgentResourcesOptions, settingsManager: SettingsManager): DefaultResourceLoader {
  return new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager,
    appendSystemPrompt: options.appendSystemPrompt
  })
}

function readProjectTrust(cwd: string, agentDir: string, diagnostics: AgentResourceDiagnostic[]): ProjectResourceTrust {
  let entry: ReturnType<ProjectTrustStore['getEntry']> = null
  try {
    entry = new ProjectTrustStore(agentDir).getEntry(cwd)
  } catch (error) {
    diagnostics.push({
      id: 'project-trust:read',
      severity: 'error',
      message: `项目资源信任记录无法读取，已按未信任处理：${friendlyError(error)}`,
      path: join(agentDir, 'trust.json')
    })
  }
  return {
    required: hasTrustRequiringProjectResources(cwd),
    decision: entry?.decision === true ? 'trusted' : entry?.decision === false ? 'blocked' : 'unset',
    savedPath: entry?.path
  }
}

function buildResourceSnapshot(
  loader: DefaultResourceLoader,
  options: LoadAgentResourcesOptions,
  trust: ProjectResourceTrust,
  extraDiagnostics: AgentResourceDiagnostic[]
): AgentResourcesSnapshot {
  const extensions = loader.getExtensions()
  const skills = loader.getSkills()
  const prompts = loader.getPrompts()
  const contexts = loader.getAgentsFiles().agentsFiles
  const resources: AgentResourceItem[] = [
    ...extensions.extensions.map((item): AgentResourceItem => ({
      id: `extension:${item.resolvedPath}`,
      kind: 'extension',
      name: basename(item.path).replace(/\.[^.]+$/, ''),
      path: item.resolvedPath,
      scope: item.sourceInfo.scope === 'project' ? 'project' : 'user'
    })),
    ...skills.skills.map((item): AgentResourceItem => ({
      id: `skill:${item.filePath}`,
      kind: 'skill',
      name: item.name,
      description: item.description,
      path: item.filePath,
      scope: item.sourceInfo.scope === 'project' ? 'project' : 'user'
    })),
    ...prompts.prompts.map((item): AgentResourceItem => ({
      id: `prompt:${item.filePath}`,
      kind: 'prompt',
      name: item.name,
      description: item.description,
      path: item.filePath,
      scope: item.sourceInfo.scope === 'project' ? 'project' : 'user'
    })),
    ...contexts.map((item): AgentResourceItem => ({
      id: `context:${item.path}`,
      kind: 'context',
      name: basename(item.path),
      path: item.path,
      scope: isInside(item.path, options.agentDir) ? 'user' : 'project'
    }))
  ]
  const diagnostics = [
    ...extraDiagnostics,
    ...extensions.errors.map((item, index): AgentResourceDiagnostic => ({
      id: `extension:${item.path}:${index}`,
      severity: 'error',
      message: `扩展加载失败：${item.error}`,
      path: item.path
    })),
    ...skills.diagnostics.map((item, index) => mapDiagnostic('技能', item, index)),
    ...prompts.diagnostics.map((item, index) => mapDiagnostic('提示模板', item, index))
  ]
  return {
    workspacePath: options.cwd,
    userResourcePath: options.agentDir,
    projectResourcePath: join(options.cwd, '.pi'),
    trust,
    resources,
    diagnostics
  }
}

function mapDiagnostic(label: string, item: ResourceDiagnostic, index: number): AgentResourceDiagnostic {
  const collision = item.collision
  return {
    id: `${label}:${item.path ?? collision?.loserPath ?? index}:${index}`,
    severity: item.type,
    message: collision
      ? `${label}“${collision.name}”重名，已使用 ${collision.winnerPath}，忽略 ${collision.loserPath}。`
      : `${label}${item.type === 'error' ? '加载失败' : '存在问题'}：${item.message}`,
    path: item.path
  }
}

function isInside(path: string, parent: string): boolean {
  const value = relative(resolve(parent), resolve(path))
  return value === '' || (!value.startsWith('..') && !value.startsWith('/'))
}
