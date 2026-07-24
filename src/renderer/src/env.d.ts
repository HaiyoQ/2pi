/// <reference types="vite/client" />
import type { AgentBridge } from '../../shared/contracts'

declare global {
  interface Window { agent: AgentBridge }
}

export {}
