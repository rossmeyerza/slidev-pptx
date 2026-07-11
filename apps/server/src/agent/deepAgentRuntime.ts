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

    let parsed = await parseDeepAgentResult(result, deck, deckRoot, before);
    if (isWorkspaceDeck(deck) && parsed.mode === 'workspace' && !parsed.changedFiles?.length) {
      // The model sometimes answers from the prompt-embedded file contents and
      // claims success without a single tool call. Confront it once on the
      // same thread before giving up; the route-level guard fails the run if
      // this retry also produces no file changes.
      options.onEvent?.('status', { status: 'retrying_no_changes' });
      const retryState = {
        messages: [{
          role: 'user',
          content: 'No deck files were actually modified — your response claimed a change that never happened. Apply the requested change NOW using write_file or edit_file tool calls, verify by re-reading the file, then return the structured output again.',
        }],
      };
      const retryResult = await runDeepAgentWithEvents(agent, retryState, runOptions, options.onEvent);
      parsed = await parseDeepAgentResult(retryResult, deck, deckRoot, before);
    }
    return { ...parsed, model: runConfig.model };
  } finally {
    await checkpointer?.end();
  }
}

async function deepAgentState(instruction: string, deck: DeckRecord, deckRoot: string) {
  if (isWorkspaceDeck(deck)) {
    const files = await readWorkspacePromptFiles(deckRoot);
    const slideSections = files.slides.flatMap((slide) => [
      '',
      `Current ${slide.path}:`,
      '```html',
      slide.content,
      '```',
    ]);
    return {
      messages: [
        {
          role: 'user',
          content: [
            'Instruction:',
            instruction,
            '',
            'Current /deck.json:',
            '```json',
            files.deckJson,
            '```',
            '',
            'Current /theme.css:',
            '```css',
            files.themeCss,
            '```',
            ...slideSections,
            '',
            'Assets available:',
            ...(files.assets.length ? files.assets.map((asset) => `- ${asset}`) : ['- (none)']),
            '',
            'After writing files, return structured output with summary and changedFiles. Do not include full file contents in the final response.',
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
      'You edit a static HTML slide deck using filesystem tools.',
      'Use virtual filesystem paths rooted at the deck directory.',
      '- Editable deck files are /deck.json (manifest), /slides/*.html (one section fragment per slide), /theme.css, and files under /assets/.',
      '- NEVER touch /index.html, /runtime.js, /runtime.css (the runtime shell), /slides.md, /package.json, or /meta.json.',
      '- Slides render on a fixed 1280x720 px stage. Design in px, never vw/vh, and ensure content neither overflows nor scrolls.',
      '- Each slide file must contain exactly one <section class="slide ..." data-title="..."> fragment: no html/head/body wrappers, <script>, or external CDN/font/asset URLs. Decks are self-contained.',
      '- Slide order lives in the slides array of /deck.json. Keep NN-slug.html filenames and the manifest synchronized when adding, removing, or reordering slides.',
      '- data-click progressively reveals an element: bare values auto-increment, while data-click="3" pins step 3. <aside class="notes"> contains presenter notes and never renders on the slide.',
      '- /deck.json transition must be "slide", "fade", or "none".',
      '- Put shared visual decisions in /theme.css: tokens on :root, layouts such as layout-cover/layout-split/layout-statement/layout-grid, and components such as data-card/stat/eyebrow/lead. Prefer theme classes to inline styles; self-host fonts under /assets/fonts with @font-face.',
      '- You cannot delete files. To remove or rename a slide, update the slides array in /deck.json; previously existing slide files no longer referenced by the manifest are pruned automatically after your run. Prefer inserting new slides without renumbering existing files unless the user asks for a reorder.',
      '- CRITICAL: any slide file you create is invisible until /deck.json lists it. Whenever you add, remove, or rename a slide file, update /deck.json in the same run and verify the write succeeded (re-read it if unsure). If an edit_file call fails, rewrite the whole file with write_file.',
      'Use read_file, write_file, edit_file, ls, glob, and grep to inspect and modify files.',
      '- Changes ONLY count when made through write_file or edit_file tool calls. Never claim an edit you did not perform with a tool — a run that modifies no files is treated as a failure. The file contents shown in the request are for reference; restating them is not editing.',
      'Return structured output with summary and changedFiles.',
      `Deck id: ${deck.meta.id}`,
    ];
    if (roleScope === 'admin') {
      return [
        ...shared,
        'Admin scope: you may restructure the theme and slide set freely within the rules above.',
      ].join('\n');
    }
    return [
      ...shared,
      'Member scope: content and presentation edits only; do not add new asset files other than under /assets/.',
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
    return [
      { operations: ['write'], paths: ['/index.html', '/runtime.js', '/runtime.css', '/package.json', '/package-lock.json', '/meta.json', '/slides.md', '/setup/**', '/vite.config.*', '/node_modules/**', '/dist/**', '/.*', '/**/.*'], mode: 'deny' },
      { operations: ['write'], paths: ['/deck.json', '/theme.css', '/slides/**', '/assets/**', '/public/**'], mode: 'allow' },
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
    await pruneOrphanSlides(deckRoot, beforeWorkspace);
    // Trust only the disk diff. The model's self-reported changedFiles can
    // claim edits that never reached disk (observed with edit_file failures);
    // counting them would let a no-op run pass for a successful one.
    const changedFiles = await changedWorkspaceFiles(deckRoot, beforeWorkspace);
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
  return Boolean(deck.meta.draftUrl?.startsWith('/runtime/')) || deck.meta.scaffoldKey === 'custom-html';
}

/**
 * The agent has no delete tool, so renames/removals leave stale slide files
 * behind. deck.json is the source of truth: after a run, slide files the
 * manifest no longer references are removed — but only files that already
 * existed before the run. A slide the agent just wrote is never pruned, so a
 * failed manifest update cannot destroy fresh work; it stays on disk as a
 * visible orphan instead. Skipped entirely when the manifest is missing,
 * corrupt, or empty so a bad agent write cannot wipe the slides directory.
 */
async function pruneOrphanSlides(deckRoot: string, beforeWorkspace: Map<string, string>): Promise<void> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(deckRoot, 'deck.json'), 'utf8')) as { slides?: unknown };
    if (!Array.isArray(manifest.slides) || !manifest.slides.length) return;
    const referenced = new Set(manifest.slides
      .filter((value): value is string => typeof value === 'string')
      .map((value) => path.posix.normalize(value.replace(/^\/+/, ''))));
    if (!referenced.size) return;
    const entries = await fs.readdir(path.join(deckRoot, 'slides'), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      if (referenced.has(`slides/${entry.name}`)) continue;
      if (!beforeWorkspace.has(`/slides/${entry.name}`)) continue;
      await fs.unlink(path.join(deckRoot, 'slides', entry.name)).catch(() => undefined);
    }
  } catch {
    // Never let cleanup break a successful agent run.
  }
}

interface WorkspacePromptFiles {
  deckJson: string;
  themeCss: string;
  slides: Array<{ path: string; content: string }>;
  assets: string[];
}

async function readWorkspacePromptFiles(deckRoot: string): Promise<WorkspacePromptFiles> {
  const read = async (relative: string) => fs.readFile(path.join(deckRoot, relative), 'utf8').catch(() => '');
  const deckJson = await read('deck.json');
  let slideFiles: string[] = [];
  let hasManifestSlideList = false;
  try {
    const manifest = JSON.parse(deckJson) as { slides?: unknown };
    if (Array.isArray(manifest.slides)) {
      hasManifestSlideList = true;
      slideFiles = manifest.slides
        .filter((value): value is string => typeof value === 'string')
        .map((value) => path.posix.normalize(value.replace(/^\/+/, '')))
        .filter((value) => value.startsWith('slides/') && value.endsWith('.html') && !value.includes('/../'));
    }
  } catch {
    // Missing or corrupt manifests fall back to the slide directory below.
  }
  if (!hasManifestSlideList) {
    const entries = await fs.readdir(path.join(deckRoot, 'slides'), { withFileTypes: true }).catch(() => []);
    slideFiles = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.html'))
      .map((entry) => `slides/${entry.name}`)
      .sort((left, right) => left.localeCompare(right));
  }

  const assets: string[] = [];
  await collectAssetNames(path.join(deckRoot, 'assets'), 'assets', assets);
  return {
    deckJson,
    themeCss: await read('theme.css'),
    slides: await Promise.all(slideFiles.map(async (file) => ({ path: `/${file}`, content: await read(file) }))),
    assets: assets.sort((left, right) => left.localeCompare(right)).map((asset) => `/${asset}`),
  };
}

async function collectAssetNames(absoluteDir: string, relativeDir: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const relative = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) await collectAssetNames(path.join(absoluteDir, entry.name), relative, results);
    else if (entry.isFile()) results.push(relative);
  }
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
  if (normalized === '/deck.json' || normalized === '/theme.css') return true;
  return normalized.startsWith('/slides/') || normalized.startsWith('/assets/') || normalized.startsWith('/public/');
}
