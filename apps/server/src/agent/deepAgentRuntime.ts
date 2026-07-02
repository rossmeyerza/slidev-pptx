import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createDeepAgent, FilesystemBackend, type FilesystemPermission } from 'deepagents';
import { ChatOpenAI } from '@langchain/openai';
import { toolStrategy } from 'langchain';
import { z } from 'zod';
import type { AppConfig, DeckRecord, UserRecord } from '../core/types.js';
import { agentRunConfig } from './agent.js';
import { createLangGraphCheckpointer } from '../db/db.js';

export interface DeepAgentEditResult {
  mode: 'markdown' | 'workspace';
  markdown?: string;
  changedFiles?: string[];
  summary: string;
  model: string;
}

export type DeepAgentEventHandler = (event: string, data: unknown) => void;

const responseFormat = z.object({
  summary: z.string(),
  markdown: z.string().optional(),
  changedFiles: z.array(z.string()).optional(),
});

/**
 * Runs the deepagents filesystem-backed editor.
 *
 * The backend is path-jailed to the deck root with virtual paths, and
 * member/admin write rules mirror the product role policy.
 */
export async function runDeepAgentDeckEdit(
  config: AppConfig,
  user: UserRecord,
  deck: DeckRecord,
  deckRoot: string,
  instruction: string,
  options: { signal?: AbortSignal; onEvent?: DeepAgentEventHandler } = {},
): Promise<DeepAgentEditResult> {
  const runConfig = agentRunConfig(config, user, deck);
  const model = new ChatOpenAI({
    model: runConfig.model,
    temperature: 0,
    apiKey: config.agent.apiKey ?? 'local-provider',
    timeout: config.agent.timeoutMs,
    configuration: {
      baseURL: runConfig.baseUrl.replace(/\/$/, ''),
    },
  });
  const backend = new FilesystemBackend({
    rootDir: deckRoot,
    virtualMode: true,
    maxFileSizeMb: 5,
  });
  const checkpointer = createLangGraphCheckpointer(config);
  const agent = createDeepAgent({
    model,
    backend,
    ...(checkpointer ? { checkpointer } : {}),
    permissions: permissionsForRole(runConfig.roleScope, deckKind(deck)),
    systemPrompt: deepAgentPrompt(runConfig.roleScope, deck),
    responseFormat: toolStrategy(responseFormat),
    name: `deck-${deck.meta.id}`,
  });

  try {
    const before = isWorkspaceDeck(deck) ? await snapshotWorkspace(deckRoot) : new Map<string, string>();
    const state = await deepAgentState(instruction, deck, deckRoot);
    const runOptions = {
      configurable: { thread_id: deck.meta.id },
      signal: options.signal,
    };
    const result = await runDeepAgentWithEvents(agent, state, runOptions, options.onEvent);

    const parsed = await parseDeepAgentResult(result, deck, deckRoot, before);
    return { ...parsed, model: runConfig.model };
  } finally {
    await checkpointer?.end();
  }
}

async function deepAgentState(instruction: string, deck: DeckRecord, deckRoot: string) {
  if (isWorkspaceDeck(deck)) {
    const files = await readWorkspacePromptFiles(deckRoot);
    return {
      messages: [
        {
          role: 'user',
          content: [
            'Instruction:',
            instruction,
            '',
            'This is a custom HTML deck, not a Slidev deck.',
            'Edit the real workspace files using filesystem tools. Do not edit /slides.md for this deck.',
            'Primary files:',
            '- /index.html',
            '- /style.css',
            '- /deck.js',
            'You may also create or update files under /assets/** or /public/** if needed.',
            'After writing files, return structured output with summary and changedFiles. Do not include full file contents in the final response.',
            '',
            'Current /index.html:',
            '```html',
            files.indexHtml,
            '```',
            '',
            'Current /style.css:',
            '```css',
            files.styleCss,
            '```',
            '',
            'Current /deck.js:',
            '```js',
            files.deckJs,
            '```',
          ].join('\n'),
        },
      ],
    };
  }

  return {
    messages: [
      {
        role: 'user',
        content: [
          instruction,
          '',
          'Edit /slides.md and return the full replacement markdown plus a concise summary.',
          'Current /slides.md:',
          '```md',
          deck.markdown,
          '```',
        ].join('\n'),
      },
    ],
  };
}

async function runDeepAgentWithEvents(
  agent: unknown,
  state: Awaited<ReturnType<typeof deepAgentState>>,
  config: { configurable: { thread_id: string }; signal?: AbortSignal },
  onEvent?: DeepAgentEventHandler,
): Promise<unknown> {
  const candidate = agent as {
    streamEvents?: (state: unknown, config: Record<string, unknown>) => Promise<DeepAgentRunProjection>;
    invoke?: (state: unknown, config: Record<string, unknown>) => Promise<unknown>;
  };
  if (!onEvent || typeof candidate.streamEvents !== 'function') {
    if (typeof candidate.invoke !== 'function') throw new Error('Deep agent runtime is not invokable');
    return candidate.invoke(state, config);
  }

  onEvent('status', { status: 'deepagent_stream_starting' });
  const run = await candidate.streamEvents(state, { ...config, version: 'v3' });
  const observers = observeDeepAgentRunEvents(run, onEvent);
  try {
    const output = await run.output;
    await Promise.allSettled(observers);
    return output;
  } catch (error) {
    await Promise.allSettled(observers);
    throw error;
  }
}

export interface DeepAgentRunProjection {
  output: Promise<unknown>;
  messages?: AsyncIterable<unknown>;
  toolCalls?: AsyncIterable<unknown>;
  values?: AsyncIterable<unknown>;
}

export function observeDeepAgentRunEvents(run: DeepAgentRunProjection, onEvent: DeepAgentEventHandler): Promise<void>[] {
  return [
    observeDeepAgentMessages(run, onEvent),
    observeDeepAgentToolCalls(run, onEvent),
    observeDeepAgentValues(run, onEvent),
  ];
}

async function observeDeepAgentMessages(run: DeepAgentRunProjection, onEvent: DeepAgentEventHandler): Promise<void> {
  if (!run.messages) return;
  for await (const message of run.messages) {
    const stream = streamProperty(message, 'text');
    if (!stream) continue;
    for await (const token of stream) {
      const value = stringifyStreamValue(token);
      if (value) onEvent('token', { token: value, source: 'deepagents' });
    }
  }
}

async function observeDeepAgentToolCalls(run: DeepAgentRunProjection, onEvent: DeepAgentEventHandler): Promise<void> {
  if (!run.toolCalls) return;
  for await (const call of run.toolCalls) {
    const record = call && typeof call === 'object' ? call as Record<string, unknown> : {};
    const name = typeof record.name === 'string' ? record.name : 'tool';
    const id = typeof record.id === 'string' ? record.id : typeof record.tool_call_id === 'string' ? record.tool_call_id : undefined;
    onEvent('tool_call', { name, id, input: await settledValue(record.input), status: await settledValue(record.status) });
    onEvent('tool_result', { name, id, output: await settledValue(record.output), status: await settledValue(record.status) });
  }
}

async function observeDeepAgentValues(run: DeepAgentRunProjection, onEvent: DeepAgentEventHandler): Promise<void> {
  if (!run.values) return;
  let lastFiles = new Set<string>();
  for await (const value of run.values) {
    const files = filePathsFromValue(value);
    for (const file of files) {
      if (!lastFiles.has(file)) onEvent('file_activity', { path: file });
    }
    if (files.size) lastFiles = files;
  }
}

function streamProperty(value: unknown, key: string): AsyncIterable<unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === 'object' && Symbol.asyncIterator in candidate
    ? candidate as AsyncIterable<unknown>
    : undefined;
}

function stringifyStreamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (typeof value === 'object' && 'content' in value && typeof (value as { content?: unknown }).content === 'string') {
    return (value as { content: string }).content;
  }
  return '';
}

async function settledValue(value: unknown): Promise<unknown> {
  try {
    return await value;
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function filePathsFromValue(value: unknown): Set<string> {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const files = record.files && typeof record.files === 'object' ? record.files as Record<string, unknown> : {};
  return new Set(Object.keys(files));
}

function deepAgentPrompt(roleScope: 'admin' | 'member', deck: DeckRecord): string {
  if (isWorkspaceDeck(deck)) {
    const shared = [
      'You edit a file-based custom HTML deck using filesystem tools.',
      'Use virtual filesystem paths rooted at the deck directory.',
      'The deck runtime reads /index.html, /style.css, and /deck.js directly. Those files are the source of truth.',
      'Use read_file, write_file, edit_file, ls, glob, and grep to inspect and modify files.',
      'Do not edit /slides.md for custom HTML decks.',
      'Return structured output with summary and changedFiles.',
      `Deck id: ${deck.meta.id}`,
    ];
    if (roleScope === 'admin') {
      return [
        ...shared,
        'Admin scope: you may edit HTML, CSS, JS, and deck-local assets. Keep the deck self-contained and do not depend on external build tools.',
      ].join('\n');
    }
    return [
      ...shared,
      'Member scope: content and presentation only. Do not edit package metadata, hidden files, or server/application code.',
    ].join('\n');
  }

  const shared = [
    'You edit Slidev decks using filesystem tools.',
    'Use virtual filesystem paths rooted at the deck directory.',
    'The primary file is /slides.md.',
    'Return structured output with markdown and summary.',
    `Deck id: ${deck.meta.id}`,
  ];
  if (roleScope === 'admin') {
    return [
      ...shared,
      'Admin scope: you may edit deck content, theme code, layouts, components, and dependency metadata inside the deck root.',
    ].join('\n');
  }
  return [
    ...shared,
    'Member scope: content-only. Do not edit theme code, package metadata, setup files, Vite config, hidden files, or Vue components.',
  ].join('\n');
}

export function permissionsForRole(roleScope: 'admin' | 'member', kind: 'slidev' | 'workspace' = 'slidev'): FilesystemPermission[] {
  if (kind === 'workspace') {
    const commonDeny: FilesystemPermission[] = [
      { operations: ['write'], paths: ['/package.json', '/package-lock.json', '/setup/**', '/vite.config.*', '/node_modules/**', '/dist/**', '/meta.json', '/slides.md', '/.*', '/**/.*'], mode: 'deny' },
    ];
    if (roleScope === 'admin') {
      return [
        ...commonDeny,
        { operations: ['write'], paths: ['/index.html', '/style.css', '/deck.js', '/assets/**', '/public/**'], mode: 'allow' },
        { operations: ['write'], paths: ['/**'], mode: 'deny' },
        { operations: ['read'], paths: ['/**'], mode: 'allow' },
      ];
    }
    return [
      ...commonDeny,
      { operations: ['write'], paths: ['/index.html', '/style.css', '/deck.js', '/assets/**', '/public/**'], mode: 'allow' },
      { operations: ['write'], paths: ['/**'], mode: 'deny' },
      { operations: ['read'], paths: ['/**'], mode: 'allow' },
    ];
  }

  if (roleScope === 'admin') {
    return [
      { operations: ['read', 'write'], paths: ['/**'], mode: 'allow' },
    ];
  }
  return [
    { operations: ['write'], paths: ['/theme/**', '/package.json', '/package-lock.json', '/setup/**', '/vite.config.*', '/**/*.vue', '/.*', '/**/.*'], mode: 'deny' },
    { operations: ['write'], paths: ['/slides.md', '/public/**', '/assets/**', '/slides/*.md'], mode: 'allow' },
    { operations: ['write'], paths: ['/**'], mode: 'deny' },
    { operations: ['read'], paths: ['/**'], mode: 'allow' },
  ];
}

async function parseDeepAgentResult(
  result: unknown,
  deck: DeckRecord,
  deckRoot: string,
  beforeWorkspace: Map<string, string>,
): Promise<Omit<DeepAgentEditResult, 'model'>> {
  const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
  const structured = record.structuredResponse ?? record.structured_response ?? record.response;
  const candidate = structured && typeof structured === 'object' ? structured as Record<string, unknown> : record;

  if (isWorkspaceDeck(deck)) {
    const detected = await changedWorkspaceFiles(deckRoot, beforeWorkspace);
    const reported = Array.isArray(candidate.changedFiles)
      ? candidate.changedFiles.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    const changedFiles = [...new Set([...detected, ...reported.map(normalizeVirtualPath).filter(isWorkspaceEditablePath)])].sort();
    return {
      mode: 'workspace',
      changedFiles,
      summary: typeof candidate.summary === 'string' && candidate.summary.trim() ? candidate.summary.trim() : 'Updated the deck workspace.',
    };
  }

  if (typeof candidate.markdown !== 'string' || !candidate.markdown.trim()) {
    throw Object.assign(new Error('Deep agent did not return markdown'), { statusCode: 502 });
  }
  return {
    mode: 'markdown',
    markdown: candidate.markdown,
    summary: typeof candidate.summary === 'string' && candidate.summary.trim() ? candidate.summary.trim() : 'Updated the deck.',
  };
}

function deckKind(deck: DeckRecord): 'slidev' | 'workspace' {
  return isWorkspaceDeck(deck) ? 'workspace' : 'slidev';
}

function isWorkspaceDeck(deck: DeckRecord): boolean {
  return deck.meta.scaffoldKey === 'custom-html';
}

async function readWorkspacePromptFiles(deckRoot: string): Promise<{ indexHtml: string; styleCss: string; deckJs: string }> {
  const read = async (relative: string) => fs.readFile(path.join(deckRoot, relative), 'utf8').catch(() => '');
  return {
    indexHtml: await read('index.html'),
    styleCss: await read('style.css'),
    deckJs: await read('deck.js'),
  };
}

async function snapshotWorkspace(deckRoot: string): Promise<Map<string, string>> {
  const files = await listWorkspaceEditableFiles(deckRoot);
  const entries = await Promise.all(files.map(async (file) => {
    const content = await fs.readFile(path.join(deckRoot, file));
    return [`/${file}`, crypto.createHash('sha256').update(content).digest('hex')] as const;
  }));
  return new Map(entries);
}

async function changedWorkspaceFiles(deckRoot: string, before: Map<string, string>): Promise<string[]> {
  const after = await snapshotWorkspace(deckRoot);
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys]
    .filter((key) => before.get(key) !== after.get(key))
    .filter(isWorkspaceEditablePath)
    .sort();
}

async function listWorkspaceEditableFiles(deckRoot: string): Promise<string[]> {
  const results: string[] = [];
  await collectWorkspaceFiles(deckRoot, '', results);
  return results.sort((left, right) => left.localeCompare(right));
}

async function collectWorkspaceFiles(root: string, relativeDir: string, results: string[]): Promise<void> {
  const absoluteDir = path.join(root, relativeDir);
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.posix.join(relativeDir.replaceAll(path.sep, '/'), entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist'].includes(entry.name)) continue;
      await collectWorkspaceFiles(root, relative, results);
      continue;
    }
    if (!entry.isFile()) continue;
    const virtualPath = `/${relative}`;
    if (isWorkspaceEditablePath(virtualPath)) results.push(relative);
  }
}

function normalizeVirtualPath(value: string): string {
  const normalized = path.posix.normalize(`/${value.trim().replace(/^\/+/, '')}`);
  return normalized === '/.' ? '/' : normalized;
}

function isWorkspaceEditablePath(value: string): boolean {
  const normalized = normalizeVirtualPath(value);
  if (normalized === '/index.html' || normalized === '/style.css' || normalized === '/deck.js') return true;
  return normalized.startsWith('/assets/') || normalized.startsWith('/public/');
}
