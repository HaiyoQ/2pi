<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Bot, Check, CircleAlert, CircleCheck, CircleHelp, FileCode2, FileText, Image, LibraryBig, LockKeyhole, Plus, RefreshCw, Search, Settings2, ShieldCheck, ShieldOff, Sparkles, Trash2, Wrench, X } from 'lucide-vue-next'
import { AGENT_TOOL_NAMES } from '../../../shared/contracts'
import type { AgentPreferences, AgentResourceKind, AgentToolName, ConnectionTestResult, ProviderDraft, ProviderProfile, ProviderProtocol } from '../../../shared/contracts'
import { useAgentStore } from '../stores/agent'

const emit = defineEmits<{ close: [] }>()
const store = useAgentStore()
const page = ref<'models' | 'agent' | 'resources'>('models')
const agentDraft = ref<AgentPreferences>()
const selectedProviderId = ref('')
const draft = ref<ProviderDraft>()
const apiKey = ref('')
const providerSearch = ref('')
const selectedProviderTab = ref('custom')
const testing = ref(false)
const testResult = ref<ConnectionTestResult>()
const discoveredModelSearch = ref('')

const locked = computed(() => store.running || store.settings?.runtimeBusy)
const selectedProfile = computed(() => store.settings?.providers.find((item) => item.id === selectedProviderId.value))
const hasProviderSearch = computed(() => Boolean(providerSearch.value.trim()))
const providerResults = computed(() => {
  const query = providerSearch.value.trim().toLowerCase()
  const providers = store.settings?.providers ?? []
  return query ? providers.filter((item) => `${item.name} ${item.id} ${protocolLabel(item.protocol)}`.toLowerCase().includes(query)) : providers
})
const catalogResults = computed(() => {
  const query = providerSearch.value.trim().toLowerCase()
  const savedIds = new Set((store.settings?.providers ?? []).map((item) => item.id))
  const available = store.providerCatalog.filter((item) => !savedIds.has(item.id))
  return query ? available.filter((item) => `${item.name} ${item.id} ${protocolLabel(item.protocol)}`.toLowerCase().includes(query)) : available
})
const customProviderVisible = computed(() => !providerSearch.value.trim()
  || '自定义供应商 openai anthropic google 兼容接口'.includes(providerSearch.value.trim().toLowerCase()))
const providerResultCount = computed(() => providerResults.value.length + catalogResults.value.length + (customProviderVisible.value ? 1 : 0))
const baseUrlFeedback = computed(() => connectionFieldFeedback('baseUrl'))
const apiKeyFeedback = computed(() => connectionFieldFeedback('apiKey'))
const configuredModelCount = computed(() => draft.value?.models.filter((model) => model.id.trim()).length ?? 0)
const discoveredModels = computed(() => {
  const query = discoveredModelSearch.value.trim().toLowerCase()
  const models = testResult.value?.models ?? []
  return query
    ? models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(query))
    : models
})
const activeModelLabel = computed(() => {
  const active = store.settings?.activeModel
  if (!active) return '未选择模型'
  const provider = store.settings?.providers.find((item) => item.id === active.providerId)
  const model = provider?.models.find((item) => item.id === active.modelId)
  return `${model?.name || active.modelId} · ${provider?.name || active.providerId}`
})

onMounted(() => {
  if (store.settings) agentDraft.value = { ...store.settings.agent, enabledTools: [...store.settings.agent.enabledTools] }
  const id = store.settings?.activeModel?.providerId || store.settings?.providers[0]?.id
  if (id) selectProvider(id)
  else startCustom()
})

function selectProvider(id: string): void {
  const profile = store.settings?.providers.find((item) => item.id === id)
  if (!profile) return
  selectedProviderId.value = id
  draft.value = profileDraft(profile)
  apiKey.value = ''
  testResult.value = undefined
  selectedProviderTab.value = `saved:${id}`
}

function startCustom(): void {
  draft.value = {
    type: 'custom',
    name: '自定义供应商',
    protocol: 'openai-chat',
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [blankModel()],
    headers: []
  }
  selectedProviderId.value = ''
  apiKey.value = ''
  testResult.value = undefined
  selectedProviderTab.value = 'custom'
}

function startBuiltin(id: string): void {
  const item = store.providerCatalog.find((entry) => entry.id === id)
  if (!item) return
  draft.value = {
    id: item.id,
    type: 'builtin',
    name: item.name,
    protocol: item.protocol,
    baseUrl: item.baseUrl,
    models: item.models.map((model) => ({ ...model })),
    headers: []
  }
  selectedProviderId.value = ''
  apiKey.value = ''
  testResult.value = undefined
  selectedProviderTab.value = `catalog:${id}`
}

function addModel(): void {
  draft.value?.models.push(blankModel())
}

function addHeader(): void {
  draft.value?.headers.push({ name: '', value: '' })
  clearConnectionTest()
}

function removeHeader(index: number): void {
  draft.value?.headers.splice(index, 1)
  clearConnectionTest()
}

function normalizedDraft(): ProviderDraft | undefined {
  if (!draft.value) return undefined
  return {
    ...draft.value,
    apiKey: apiKey.value.trim() || undefined,
    models: draft.value.models
      .filter((model) => model.id.trim())
      .map((model) => ({ ...model, id: model.id.trim(), name: model.name.trim() || model.id.trim() })),
    headers: draft.value.headers
      .filter((header) => header.name.trim())
      .map((header) => ({ ...header, name: header.name.trim() }))
  }
}

async function saveProvider(activateModelId?: string): Promise<void> {
  const value = normalizedDraft()
  if (!value) return
  try {
    await store.saveProvider(value)
    const saved = value.id
      ? store.settings?.providers.find((item) => item.id === value.id)
      : store.settings?.providers.at(-1)
    if (!saved) throw new Error('供应商保存后未找到，请重试')
    selectProvider(saved.id)
    const modelId = activateModelId ?? (!store.settings?.activeModel ? saved.models[0]?.id : undefined)
    if (modelId) {
      await store.activateModel({ providerId: saved.id, modelId })
    }
    ElMessage.success(modelId ? '模型已添加并启用' : '供应商设置已保存')
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

function saveProviderFromButton(): void {
  void saveProvider()
}

async function testConnection(): Promise<void> {
  const value = normalizedDraft()
  if (!value) return
  testing.value = true
  testResult.value = undefined
  discoveredModelSearch.value = ''
  try {
    testResult.value = await store.testProvider(value)
  } catch (error) {
    testResult.value = { ok: false, message: errorText(error), models: [] }
  } finally {
    testing.value = false
  }
}

function clearConnectionTest(): void {
  testResult.value = undefined
  discoveredModelSearch.value = ''
}

function connectionFieldFeedback(field: 'baseUrl' | 'apiKey'): { kind: 'success' | 'error'; message: string } | undefined {
  const result = testResult.value
  if (!result) return undefined
  if (result.ok) {
    if (field === 'baseUrl') return { kind: 'success', message: '服务地址连接成功' }
    const hasKey = Boolean(apiKey.value.trim() || (selectedProfile.value?.hasApiKey && !draft.value?.clearApiKey))
    return { kind: 'success', message: hasKey ? '认证信息验证通过' : '当前服务无需 API Key 即可访问' }
  }
  if (result.failedField === field) return { kind: 'error', message: result.message }
  if (result.failedField === 'apiKey' && field === 'baseUrl') return { kind: 'success', message: '服务地址可访问' }
  return undefined
}

async function selectDiscoveredModel(id: string): Promise<void> {
  const model = testResult.value?.models.find((item) => item.id === id)
  if (locked.value || !model || !draft.value) return
  if (!draft.value.models.some((item) => item.id === id)) draft.value.models.push({ ...model })
  await saveProvider(model.id)
}

async function removeProvider(): Promise<void> {
  const profile = selectedProfile.value
  if (!profile) return
  try {
    await ElMessageBox.confirm(`删除“${profile.name}”？会话记录不会被删除。`, '删除供应商', { type: 'warning' })
    await store.deleteProvider(profile.id)
    const next = store.settings?.providers[0]
    if (next) selectProvider(next.id)
    else startCustom()
    ElMessage.success('供应商已删除')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(errorText(error))
  }
}

async function activate(providerId: string, modelId: string): Promise<void> {
  try {
    await store.activateModel({ providerId, modelId })
    ElMessage.success('当前模型已切换，会话历史已保留')
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

function openAgentSettings(): void {
  page.value = 'agent'
  if (store.settings) agentDraft.value = { ...store.settings.agent, enabledTools: [...store.settings.agent.enabledTools] }
}

async function openAgentResources(): Promise<void> {
  page.value = 'resources'
  try {
    await store.loadAgentResources()
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

async function refreshAgentResources(): Promise<void> {
  try {
    await store.loadAgentResources(true)
    ElMessage.success('Agent 资源已重新加载')
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

async function changeProjectTrust(trusted: boolean): Promise<void> {
  try {
    if (trusted) {
      await ElMessageBox.confirm(
        '信任后会加载此项目及其父目录中的技能、提示模板和扩展。项目扩展可以执行任意本地代码，之后新增或修改的资源也会自动加载。',
        '信任项目资源',
        { type: 'warning', confirmButtonText: '信任并加载', cancelButtonText: '取消' }
      )
    } else {
      await ElMessageBox.confirm('撤销后，项目级技能、提示模板和扩展将停止加载；用户级资源不受影响。', '撤销项目资源信任', {
        confirmButtonText: '撤销信任', cancelButtonText: '取消'
      })
    }
    await store.setProjectResourceTrust(trusted)
    ElMessage.success(trusted ? '项目资源已信任并加载' : '项目资源信任已撤销')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') ElMessage.error(errorText(error))
  }
}

async function chooseResourceWorkspace(): Promise<void> {
  try {
    await store.chooseWorkspace()
    await store.loadAgentResources(true)
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

function resourceKindLabel(kind: AgentResourceKind): string {
  return ({ skill: '技能', prompt: '提示模板', extension: '扩展', context: '项目说明' })[kind]
}

async function saveAgentPreferences(): Promise<void> {
  if (!agentDraft.value) return
  try {
    await store.saveAgentPreferences(agentDraft.value)
    agentDraft.value = store.settings ? { ...store.settings.agent, enabledTools: [...store.settings.agent.enabledTools] } : undefined
    ElMessage.success('Agent 设置已保存')
  } catch (error) {
    ElMessage.error(errorText(error))
  }
}

function toolLabel(tool: AgentToolName): string {
  return ({ read: '读取文件', grep: '搜索内容', find: '查找文件', ls: '列出目录', bash: '运行命令', edit: '编辑文件', write: '写入文件' })[tool]
}

function toolRestricted(tool: AgentToolName): boolean {
  return agentDraft.value?.executionMode === 'read-only' && (tool === 'bash' || tool === 'edit' || tool === 'write')
}

function profileDraft(profile: ProviderProfile): ProviderDraft {
  return {
    id: profile.id,
    type: profile.type,
    name: profile.name,
    protocol: profile.protocol,
    baseUrl: profile.baseUrl,
    models: profile.models.map((model) => ({ ...model })),
    headers: profile.headers.map((header) => ({ name: header.name }))
  }
}

function blankModel() {
  return { id: '', name: '', reasoning: false, input: ['text'] as ('text' | 'image')[], contextWindow: 128_000, maxTokens: 16_000, toolUse: true }
}

function protocolLabel(protocol: ProviderProtocol): string {
  return ({
    'openai-chat': 'OpenAI Chat',
    'openai-responses': 'OpenAI Responses',
    'anthropic-messages': 'Anthropic Messages',
    'google-generative-ai': 'Google Generative AI'
  })[protocol]
}

function errorText(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause)
  return raw.replace(/^Error invoking remote method '[^']+': Error: /, '')
}
</script>

<template>
  <section class="settings-workspace">
    <header class="workspace-header settings-header">
      <button class="icon-action" type="button" title="返回任务" @click="emit('close')"><ArrowLeft :size="17" /></button>
      <div><h1>设置</h1><p>全局配置 · 保存后从下一次任务开始生效</p></div>
    </header>

    <div class="settings-layout">
      <aside class="settings-navigation" aria-label="设置页面">
        <button type="button" aria-label="模型供应商" title="模型供应商" :class="{ active: page === 'models' }" @click="page = 'models'"><Settings2 :size="16" /><span>模型供应商</span></button>
        <button type="button" aria-label="Agent 设置" title="Agent 设置" :class="{ active: page === 'agent' }" @click="openAgentSettings"><Bot :size="16" /><span>Agent 设置</span></button>
        <button type="button" aria-label="Agent 资源" title="Agent 资源" :class="{ active: page === 'resources' }" @click="openAgentResources"><LibraryBig :size="16" /><span>Agent 资源</span></button>
        <div class="settings-storage-note">
          <LockKeyhole :size="15" />
          <span>密钥仅在 Electron 主进程解密。</span>
        </div>
      </aside>

      <main class="settings-content">
        <div v-if="locked" class="runtime-lock">
          <LockKeyhole :size="15" /><span><strong>任务运行期间设置已锁定</strong>停止或等待当前任务完成后再修改。</span>
        </div>

        <div class="settings-content-inner" :class="{ 'model-settings-content': page === 'models' }">
          <header v-if="page === 'models'" class="settings-title">
            <h2>模型供应商</h2>
            <p>管理用于 Agent 的连接、密钥和模型。配置保存在本机设置文件中。</p>
          </header>

          <div v-if="page === 'models'" class="provider-settings-pane">
            <aside class="provider-tabs" aria-label="供应商列表">
              <div class="provider-search">
                <el-input v-model="providerSearch" :prefix-icon="Search" clearable placeholder="搜索供应商" aria-label="搜索供应商" />
                <span v-if="hasProviderSearch">{{ providerResultCount }} 个结果</span>
              </div>
              <div class="provider-tab-scroll">
                <div v-if="!hasProviderSearch && providerResults.length" class="provider-tab-group-label">已添加</div>
                <button v-for="item in providerResults" :key="item.id" type="button" class="provider-tab" :class="{ selected: selectedProviderTab === `saved:${item.id}` }" @click="selectProvider(item.id)">
                  <span><strong>{{ item.name }}</strong><small>{{ protocolLabel(item.protocol) }}<template v-if="store.settings?.activeModel?.providerId === item.id"> · 使用中</template></small></span>
                  <Check v-if="selectedProviderTab === `saved:${item.id}`" :size="15" />
                </button>

                <div v-if="!hasProviderSearch && (customProviderVisible || catalogResults.length)" class="provider-tab-group-label provider-tab-add-label">添加供应商</div>
                <button v-if="customProviderVisible" type="button" class="provider-tab" :class="{ selected: selectedProviderTab === 'custom' }" :disabled="locked" @click="startCustom">
                  <span><strong>自定义供应商</strong><small>兼容 OpenAI、Anthropic 或 Google</small></span>
                  <Check v-if="selectedProviderTab === 'custom'" :size="15" /><Plus v-else :size="15" />
                </button>
                <button v-for="item in catalogResults" :key="`catalog-${item.id}`" type="button" class="provider-tab" :class="{ selected: selectedProviderTab === `catalog:${item.id}` }" :disabled="locked" @click="startBuiltin(item.id)">
                  <span><strong>{{ item.name }}</strong><small>连接后拉取模型 · {{ protocolLabel(item.protocol) }}</small></span>
                  <Check v-if="selectedProviderTab === `catalog:${item.id}`" :size="15" /><Plus v-else :size="15" />
                </button>
                <div v-if="!providerResultCount" class="provider-tab-empty"><Search :size="16" /><span>没有匹配的供应商</span></div>
              </div>
            </aside>

            <section class="provider-editor">
            <template v-if="draft">
            <section class="settings-section provider-heading">
              <div><h3>{{ selectedProfile ? selectedProfile.name : draft.name }}</h3><p>{{ selectedProfile ? '编辑连接信息和可用模型。' : '完成配置后保存此供应商。' }}</p></div>
              <button v-if="selectedProfile" type="button" class="danger-text-button" :disabled="locked" @click="removeProvider"><Trash2 :size="14" />删除</button>
            </section>

            <section v-if="selectedProfile" class="active-model-row">
              <span><small>当前模型</small><strong>{{ store.settings?.activeModel?.providerId === selectedProfile.id ? activeModelLabel : '未使用此供应商' }}</strong></span>
              <el-select :model-value="store.settings?.activeModel?.providerId === selectedProfile.id ? store.settings.activeModel.modelId : ''" placeholder="选择模型" :disabled="locked" @change="activate(selectedProfile.id, String($event))">
                <el-option v-for="model in selectedProfile.models" :key="model.id" :label="model.name" :value="model.id" />
              </el-select>
            </section>

            <el-form label-position="top" :disabled="locked" class="provider-form">
              <div class="form-grid">
                <el-form-item label="显示名称"><el-input v-model="draft.name" /></el-form-item>
                <el-form-item label="协议"><el-select v-model="draft.protocol" class="full-width" @change="clearConnectionTest"><el-option label="OpenAI Chat" value="openai-chat" /><el-option label="OpenAI Responses" value="openai-responses" /><el-option label="Anthropic Messages" value="anthropic-messages" /><el-option label="Google Generative AI" value="google-generative-ai" /></el-select></el-form-item>
              </div>
              <el-form-item label="Base URL" class="connection-field">
                <el-input v-model="draft.baseUrl" placeholder="https://api.example.com/v1" @input="clearConnectionTest" />
                <p v-if="baseUrlFeedback" class="field-feedback" :class="baseUrlFeedback.kind" :role="baseUrlFeedback.kind === 'error' ? 'alert' : 'status'"><CircleCheck v-if="baseUrlFeedback.kind === 'success'" :size="13" /><CircleAlert v-else :size="13" />{{ baseUrlFeedback.message }}</p>
              </el-form-item>
              <el-form-item label="API Key" class="connection-field">
                <el-input v-model="apiKey" type="password" show-password :disabled="draft.clearApiKey" :placeholder="selectedProfile?.hasApiKey ? '已安全保存，留空则不修改' : '可留空（适用于本地免认证服务）'" @input="clearConnectionTest" />
                <p v-if="apiKeyFeedback" class="field-feedback" :class="apiKeyFeedback.kind" :role="apiKeyFeedback.kind === 'error' ? 'alert' : 'status'"><CircleCheck v-if="apiKeyFeedback.kind === 'success'" :size="13" /><CircleAlert v-else :size="13" />{{ apiKeyFeedback.message }}</p>
                <el-checkbox v-if="selectedProfile?.hasApiKey" v-model="draft.clearApiKey" class="clear-secret" @change="clearConnectionTest">删除已保存的 API Key</el-checkbox>
              </el-form-item>

              <div class="section-heading"><span>请求头</span><el-button text :icon="Plus" @click="addHeader">添加</el-button></div>
              <p v-if="!draft.headers.length" class="inline-empty">没有自定义请求头</p>
              <div v-for="(header, index) in draft.headers" :key="index" class="header-row"><el-input v-model="header.name" placeholder="Header 名称" @input="clearConnectionTest" /><el-input v-model="header.value" :placeholder="selectedProfile?.headers.some(item => item.name === header.name) ? '已保存，留空则不修改' : 'Header 值'" type="password" show-password @input="clearConnectionTest" /><el-button text :icon="X" title="删除请求头" @click="removeHeader(index)" /></div>

              <div class="section-heading model-section-heading">
                <span>模型<small v-if="configuredModelCount">{{ configuredModelCount }} 个</small></span>
                <span class="model-section-actions">
                  <el-button text :icon="Plus" @click="addModel">手动添加</el-button>
                </span>
              </div>
              <p v-if="!draft.models.length" class="inline-empty model-empty">尚未拉取模型。测试连接后可从结果中选择，或手动添加。</p>
              <div v-if="draft.models.length" class="configured-models">
                <div v-for="(model, index) in draft.models" :key="index" class="model-row">
                  <el-input v-model="model.id" placeholder="模型 ID" />
                  <el-input v-model="model.name" placeholder="显示名称（可选）" />
                  <div class="reasoning-option">
                    <el-checkbox v-model="model.reasoning">推理</el-checkbox>
                    <el-tooltip placement="top" effect="light" popper-class="reasoning-tooltip" :show-after="250">
                      <template #content><span>开启表示该模型支持推理能力，SDK 会按 Agent 的“思考级别”发送 reasoning/thinking 参数。它不会控制流式输出或工具调用；模型不支持时请关闭。</span></template>
                      <button type="button" class="inline-help" aria-label="了解推理选项"><CircleHelp :size="14" /></button>
                    </el-tooltip>
                  </div>
                  <div class="model-capability-options">
                    <el-checkbox :model-value="model.input?.includes('image')" @change="model.input = $event ? ['text', 'image'] : ['text']"><Image :size="13" />图片</el-checkbox>
                    <el-checkbox v-model="model.toolUse"><Wrench :size="13" />工具</el-checkbox>
                  </div>
                  <div class="model-limit-fields">
                    <el-input-number v-model="model.contextWindow" :min="1024" :max="10000000" :step="1024" controls-position="right" aria-label="上下文窗口" />
                    <el-input-number v-model="model.maxTokens" :min="1" :max="10000000" :step="1024" controls-position="right" aria-label="最大输出" />
                  </div>
                  <el-button text :icon="X" title="删除模型" @click="draft.models.splice(index, 1)" />
                </div>
              </div>
            </el-form>

            <div class="connection-test-row">
              <el-button :loading="testing" :disabled="locked" @click="testConnection">测试连接并拉取模型</el-button>
              <span>点击下方模型即可自动添加并启用；也可手动填写模型后保存。</span>
            </div>
            <el-alert v-if="testResult" :title="testResult.message" :type="testResult.ok ? 'success' : 'error'" show-icon :closable="false" />
            <section v-if="testResult?.models.length" class="discovered-model-panel" aria-label="拉取到的模型">
              <div class="discovered-model-toolbar">
                <span><strong>拉取到 {{ testResult.models.length }} 个模型</strong><small>点击模型即可自动加入当前供应商并启用。</small></span>
                <el-input v-model="discoveredModelSearch" :prefix-icon="Search" clearable placeholder="搜索模型" aria-label="搜索拉取到的模型" />
              </div>
              <div v-if="discoveredModels.length" class="discovered-models">
                <button v-for="model in discoveredModels" :key="model.id" type="button" :disabled="locked" @click="selectDiscoveredModel(model.id)">
                  <span><strong>{{ model.name }}</strong><small>{{ model.id }}</small></span>
                  <Check v-if="store.settings?.activeModel?.providerId === (selectedProfile?.id || draft.id) && store.settings?.activeModel?.modelId === model.id" :size="14" /><Plus v-else :size="14" />
                </button>
              </div>
              <p v-else class="discovered-model-empty">没有匹配的模型</p>
            </section>
            </template>
            </section>
          </div>

          <template v-else-if="page === 'agent' && agentDraft">
            <header class="settings-title">
              <h2>Agent 设置</h2>
              <p>这些全局设置从下一次任务开始生效。</p>
            </header>

            <el-alert v-if="store.settings?.agentNeedsConfirmation" class="agent-migration-alert" type="warning" title="升级后已暂时切换为只读档，请确认执行档位并保存。" show-icon :closable="false" />

            <div class="agent-settings-list">
              <section class="agent-setting-row">
                <div><h3>执行档位</h3><p>决定 Agent 可以使用的本地工具。</p></div>
                <el-radio-group v-model="agentDraft.executionMode" :disabled="locked" size="small">
                  <el-radio-button value="read-only">只读</el-radio-button>
                  <el-radio-button value="full-auto">全自动</el-radio-button>
                </el-radio-group>
              </section>

              <section class="agent-setting-row">
                <div><h3>思考级别</h3><p>模型不支持推理时会自动使用可用级别。</p></div>
                <el-select v-model="agentDraft.thinkingLevel" :disabled="locked" class="agent-setting-control">
                  <el-option label="最少" value="minimal" />
                  <el-option label="低" value="low" />
                  <el-option label="中等" value="medium" />
                  <el-option label="高" value="high" />
                  <el-option label="极高" value="xhigh" />
                  <el-option label="最大" value="max" />
                </el-select>
              </section>

              <section class="agent-setting-row">
                <div><h3>自动重试</h3><p>服务限流或临时错误时按 SDK 策略重试。</p></div>
                <el-switch v-model="agentDraft.autoRetry" :disabled="locked" aria-label="自动重试" />
              </section>

              <fieldset class="agent-tools-fieldset" :disabled="locked">
                <legend>可用工具</legend>
                <div class="agent-tools-grid">
                  <el-checkbox v-for="tool in AGENT_TOOL_NAMES" :key="tool" v-model="agentDraft.enabledTools" :value="tool" :disabled="locked || toolRestricted(tool)">{{ toolLabel(tool) }}</el-checkbox>
                </div>
                <p v-if="agentDraft.executionMode === 'read-only'">只读档固定关闭命令、编辑和写入工具。</p>
              </fieldset>
            </div>
          </template>

          <template v-else-if="page === 'resources'">
            <header class="settings-title resource-title">
              <div><h2>Agent 资源</h2><p>查看当前会话实际加载的技能、提示模板、扩展和项目说明。</p></div>
              <button type="button" class="secondary-command" :disabled="locked || store.resourcesLoading" @click="refreshAgentResources"><RefreshCw :size="14" :class="{ spin: store.resourcesLoading }" />重新加载</button>
            </header>

            <div v-if="store.agentResources" class="resource-settings">
              <section class="resource-trust-row">
                <ShieldCheck v-if="store.agentResources.trust.decision === 'trusted'" :size="18" />
                <ShieldOff v-else :size="18" />
                <div>
                  <h3>{{ !store.agentResources.workspacePath ? '尚未选择项目' : store.agentResources.trust.decision === 'trusted' ? '项目资源已信任' : store.agentResources.trust.required ? '项目资源尚未加载' : '未发现需信任的项目资源' }}</h3>
                  <p v-if="store.agentResources.workspacePath">信任范围：{{ store.agentResources.trust.savedPath || store.agentResources.workspacePath }}</p>
                  <p v-else>选择项目后可检查项目级技能、提示模板和扩展。</p>
                </div>
                <button v-if="!store.agentResources.workspacePath" type="button" class="secondary-command" :disabled="locked || store.resourcesLoading" @click="chooseResourceWorkspace">选择项目</button>
                <button v-else-if="store.agentResources.trust.decision === 'trusted'" type="button" class="danger-text-button" :disabled="locked || store.resourcesLoading" @click="changeProjectTrust(false)">撤销信任</button>
                <button v-else-if="store.agentResources.trust.required" type="button" class="primary-command" :disabled="locked || store.resourcesLoading" @click="changeProjectTrust(true)">信任并加载</button>
              </section>

              <section class="resource-locations" aria-label="资源目录">
                <div><span>用户级目录</span><code>{{ store.agentResources.userResourcePath }}</code></div>
                <div v-if="store.agentResources.projectResourcePath"><span>项目级目录</span><code>{{ store.agentResources.projectResourcePath }}</code></div>
              </section>

              <section class="resource-section">
                <header><div><h3>已加载资源</h3><p>{{ store.agentResources.resources.length }} 项，按当前项目与信任状态生效。</p></div></header>
                <div v-if="store.agentResources.resources.length" class="resource-list">
                  <div v-for="item in store.agentResources.resources" :key="item.id" class="resource-row">
                    <Sparkles v-if="item.kind === 'skill'" :size="16" />
                    <FileText v-else-if="item.kind === 'prompt' || item.kind === 'context'" :size="16" />
                    <FileCode2 v-else :size="16" />
                    <span><strong>{{ item.name }}</strong><small>{{ item.description || item.path }}</small></span>
                    <div><span>{{ resourceKindLabel(item.kind) }}</span><small>{{ item.scope === 'project' ? '项目' : '用户' }}</small></div>
                  </div>
                </div>
                <p v-else class="resource-empty">当前目录没有可用资源。</p>
              </section>

              <section class="resource-section">
                <header><div><h3>加载诊断</h3><p>重名资源、失效路径和加载错误会显示在这里。</p></div></header>
                <div v-if="store.agentResources.diagnostics.length" class="diagnostic-list">
                  <div v-for="item in store.agentResources.diagnostics" :key="item.id" :class="['diagnostic-row', item.severity]">
                    <CircleAlert :size="15" /><span><strong>{{ item.severity === 'collision' ? '资源重名' : item.severity === 'error' ? '加载错误' : '加载警告' }}</strong><small>{{ item.message }}</small><code v-if="item.path">{{ item.path }}</code></span>
                  </div>
                </div>
                <p v-else class="resource-empty"><CircleCheck :size="14" />没有发现资源加载问题。</p>
              </section>
            </div>
            <div v-else-if="store.resourcesLoading" class="resource-loading"><RefreshCw :size="16" class="spin" />正在读取 Agent 资源</div>
            <div v-else class="resource-load-error" role="alert">
              <CircleAlert :size="17" /><span><strong>Agent 资源读取失败</strong><small>{{ store.resourceError || '无法读取当前资源状态。' }}</small></span>
              <button type="button" class="secondary-command" @click="openAgentResources">重试</button>
            </div>
          </template>
        </div>

        <footer class="settings-footer" :class="{ 'model-settings-footer': page === 'models' }">
          <button type="button" class="secondary-command" @click="emit('close')">返回任务</button>
          <button v-if="page === 'models' && draft" type="button" class="primary-command" :disabled="locked || !draft.name || !draft.baseUrl || !draft.models.some(item => item.id.trim())" @click="saveProviderFromButton">{{ selectedProfile ? '保存更改' : '保存并使用模型' }}</button>
          <button v-else-if="page === 'agent' && agentDraft" type="button" class="primary-command" :disabled="locked" @click="saveAgentPreferences">保存 Agent 设置</button>
        </footer>
      </main>
    </div>
  </section>
</template>
