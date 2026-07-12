import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DeckStore } from './decks.js';

export interface CreatedDeckFile {
  path: string;
  absolutePath: string;
}

export interface DependencyResult {
  name: string;
  version: string;
  installed: boolean;
  output?: string;
}

export class AdminToolService {
  constructor(private readonly decks: DeckStore) {}

  async createComponent(deckId: string, input: { name: string; source?: string }): Promise<CreatedDeckFile> {
    const name = componentName(input.name);
    const relativePath = path.join('theme', 'components', `${name}.vue`);
    const absolutePath = this.deckFile(deckId, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.source?.trim() || defaultComponent(name), 'utf8');
    return { path: relativePath, absolutePath };
  }

  async createLayout(deckId: string, input: { name: string; source?: string }): Promise<CreatedDeckFile> {
    const name = layoutName(input.name);
    const relativePath = path.join('theme', 'layouts', `${name}.vue`);
    const absolutePath = this.deckFile(deckId, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, input.source?.trim() || defaultLayout(name), 'utf8');
    return { path: relativePath, absolutePath };
  }

  async addDependency(deckId: string, input: { name: string; version?: string; install?: boolean }): Promise<DependencyResult> {
    const name = packageName(input.name);
    const version = packageVersion(input.version);
    const packageJsonPath = this.deckFile(deckId, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as { dependencies?: Record<string, string> };
    packageJson.dependencies = {
      ...(packageJson.dependencies ?? {}),
      [name]: version,
    };
    await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');

    if (!input.install) return { name, version, installed: false };
    const output = await npmInstall(this.decks.deckPath(deckId), name, version);
    return { name, version, installed: true, output };
  }

  private deckFile(deckId: string, relativePath: string): string {
    const root = this.decks.deckPath(deckId);
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw Object.assign(new Error('Path escapes deck root'), { statusCode: 400 });
    }
    return target;
  }
}

function componentName(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9]+(.)/g, (_, next: string) => next.toUpperCase());
  const name = `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
  if (!/^[A-Z][A-Za-z0-9]{1,63}$/.test(name)) {
    throw Object.assign(new Error('Component name must be 2-64 alphanumeric characters'), { statusCode: 400 });
  }
  return name;
}

function layoutName(value: string): string {
  const name = value.trim().replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(name)) {
    throw Object.assign(new Error('Layout name must be 2-64 URL-safe characters'), { statusCode: 400 });
  }
  return name;
}

function packageName(value: string): string {
  const name = value.trim();
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) {
    throw Object.assign(new Error('Package name must be a valid npm package name'), { statusCode: 400 });
  }
  return name;
}

function packageVersion(value?: string): string {
  const version = value?.trim() || 'latest';
  if (/^(?:file:|git\+|https?:|\/|\.{1,2}\/)/i.test(version) || !/^[~^<>=*]?[0-9A-Za-z._+-]+$/.test(version)) {
    throw Object.assign(new Error('Package version must be a registry version or dist tag'), { statusCode: 400 });
  }
  return version;
}

function defaultComponent(name: string): string {
  return `<template>
  <section class="${kebabCase(name)}">
    <slot />
  </section>
</template>
`;
}

function defaultLayout(name: string): string {
  return `<template>
  <div class="deck-layout ${name}">
    <slot />
  </div>
</template>
`;
}

function kebabCase(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

async function npmInstall(cwd: string, name: string, version: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['install', `${name}@${version}`], {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(Object.assign(new Error('npm install timed out'), { statusCode: 504 }));
    }, 120_000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk) => { output += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(Object.assign(error, { statusCode: 500 }));
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve(output.trim());
      else reject(Object.assign(new Error(output.trim() || `npm install exited with ${code}`), { statusCode: 500 }));
    });
  });
}
