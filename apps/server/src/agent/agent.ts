import type { AppConfig, DeckRecord, UserRecord } from '../core/types.js';
import { runDeepAgentDeckEdit } from './deepAgentRuntime.js';

export interface AgentEditResult {
  mode: 'markdown' | 'workspace';
  markdown?: string;
  changedFiles?: string[];
  summary: string;
  model: string;
}

export interface AgentRunConfig {
  roleScope: 'admin' | 'member';
  model: string;
  baseUrl: string;
  timeoutMs: number;
}

export type AgentEventHandler = (event: string, data: unknown) => void;

/**
 * Deck-editing agent backed by deepagents filesystem tools.
 */
export async function runDeckEditAgent(
  config: AppConfig,
  user: UserRecord,
  deck: DeckRecord,
  instruction: string,
  options: { signal?: AbortSignal; deckRoot?: string; onEvent?: AgentEventHandler; history?: Array<{ role: 'user' | 'agent'; content: string }> } = {},
): Promise<AgentEditResult> {
  assertAgentInstructionAllowed(user, instruction);
  if (!options.deckRoot) throw Object.assign(new Error('Deepagents runtime requires deckRoot'), { statusCode: 500 });
  const result = await runDeepAgentDeckEdit(config, user, deck, options.deckRoot, instruction, { signal: options.signal, onEvent: options.onEvent, history: options.history });
  if (result.mode === 'markdown') validateMarkdown(requiredMarkdown(result));
  return result;
}

function requiredMarkdown(result: AgentEditResult): string {
  if (!result.markdown) throw Object.assign(new Error('Agent did not return markdown'), { statusCode: 502 });
  return result.markdown;
}

export function agentApiKey(config: AppConfig): string {
  return config.agent.apiKey ?? 'local-provider';
}

export function assertAgentInstructionAllowed(user: UserRecord, instruction: string): void {
  if (user.role === 'admin') return;
  const normalized = instruction.toLowerCase();
  const blocked = [
    { label: 'theme files', pattern: /\btheme\/|\/theme\/|\btheme\\|\\theme\\/ },
    { label: 'package metadata', pattern: /\bpackage(?:-lock)?\.json\b|\bpnpm-lock\.yaml\b|\byarn\.lock\b/ },
    { label: 'setup files', pattern: /\bsetup\/|\/setup\/|\bsetup\\|\\setup\\/ },
    { label: 'Vite configuration', pattern: /\bvite\.config\.[cm]?[jt]s\b/ },
    { label: 'Vue components', pattern: /\.vue\b/ },
    { label: 'hidden files', pattern: /(^|\s|\/)\.[a-z0-9_-]+/ },
    { label: 'host filesystem paths', pattern: /\/etc\/passwd|\/home\/|\/root\/|\/srv\/|~\// },
    { label: 'dependency installation', pattern: /\bnpm\s+(?:install|i|add)\b|\bpnpm\s+add\b|\byarn\s+add\b/ },
    { label: 'shell commands', pattern: /\b(?:bash|sh|zsh|fish|sudo|chmod|chown|rm\s+-rf)\b/ },
  ];
  const match = blocked.find((item) => item.pattern.test(normalized));
  if (!match) return;
  throw Object.assign(new Error(`Member agent cannot access ${match.label}`), { statusCode: 403 });
}

export function agentRunConfig(config: AppConfig, user: UserRecord, deck?: DeckRecord): AgentRunConfig {
  const roleScope = user.role === 'admin' ? 'admin' : 'member';
  const deckAgent = deck?.meta.agent;
  const model = roleScope === 'admin'
    ? deckAgent?.adminModel ?? config.agent.adminModel
    : deckAgent?.memberModel ?? config.agent.memberModel;
  return {
    roleScope,
    model,
    baseUrl: deckAgent?.baseUrl ?? config.agent.baseUrl,
    timeoutMs: deckAgent?.timeoutMs ?? config.agent.timeoutMs,
  };
}

function validateMarkdown(markdown: string): void {
  if (!markdown.includes('---') || !markdown.includes('#')) {
    throw Object.assign(new Error('Agent response did not look like a Slidev markdown deck'), { statusCode: 502 });
  }
  if (markdown.length > 1_000_000) {
    throw Object.assign(new Error('Agent response is too large'), { statusCode: 502 });
  }
}
