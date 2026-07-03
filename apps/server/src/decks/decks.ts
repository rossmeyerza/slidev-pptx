import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, DeckMeta, DeckRecord, ScaffoldRecord, UserRole } from '../core/types.js';
import { readRequiredJson, readRequiredText, readText, writeJson, writeText } from '../core/storage.js';
import type { PgPool } from '../db/db.js';
import { SettingsService } from './settings.js';

const DEFAULT_MARKDOWN = `---
theme: default
title: Untitled deck
---

# Untitled deck

Start writing your Slidev deck here.
`;

/**
 * Owns deck folders under `.data/decks/<id>`.
 */
export class DeckStore {
  private configuredOrgIdPromise?: Promise<string>;

  constructor(
    private readonly config: AppConfig,
    private readonly pool: PgPool | null = null,
  ) {}

  /**
   * Lists deck metadata sorted by most recently updated first.
   */
  async list(): Promise<DeckMeta[]> {
    if (this.pool) {
      const result = await this.pool.query('select * from deck order by updated_at desc');
      return result.rows.map(rowToMeta);
    }

    const entries = await fs.readdir(this.config.decksDir, { withFileTypes: true }).catch(() => []);
    const metas = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => this.readMeta(entry.name).catch(() => null)),
    );
    return metas
      .filter((meta): meta is DeckMeta => meta !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Lists scaffold folders available under themes/.
   */
  async listScaffolds(input: { includeInactive?: boolean; userRole?: UserRole } = {}): Promise<ScaffoldRecord[]> {
    const root = path.join(this.config.repoRoot, 'themes');
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const settings = await new SettingsService(this.config).load();
    const configured = settings.scaffolds?.items ?? {};
    const defaultKey = settings.scaffolds?.defaultKey ?? this.config.scaffoldKey;
    const scaffolds = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const key = normalizeScaffoldKey(entry.name);
        if (!key) return null;
        const overrides = configured[key] ?? {};
        const isActive = overrides.isActive ?? true;
        const minRole = overrides.minRole ?? 'employee';
        if (!input.includeInactive && !isActive) return null;
        if (input.userRole !== 'admin' && minRole === 'admin') return null;
        const packageJson = await readText(path.join(root, key, 'package.json'), '{}');
        const details = parsePackageDetails(packageJson);
        return {
          key,
          name: overrides.name || details.name || labelFromKey(key),
          description: overrides.description ?? details.description ?? '',
          isDefault: key === defaultKey,
          isActive,
          minRole,
        };
      }));
    return scaffolds
      .filter((scaffold): scaffold is ScaffoldRecord => scaffold !== null)
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name));
  }

  async assertScaffoldAvailable(scaffoldKey: string, userRole: UserRole): Promise<void> {
    const normalized = normalizeScaffoldKey(scaffoldKey);
    if (!normalized) throw Object.assign(new Error('Invalid scaffold key'), { statusCode: 400 });
    await this.assertScaffoldExists(normalized);
    const scaffolds = await this.listScaffolds({ includeInactive: true, userRole: 'admin' });
    const scaffold = scaffolds.find((item) => item.key === normalized);
    if (!scaffold?.isActive) throw Object.assign(new Error(`Scaffold is inactive: ${normalized}`), { statusCode: 403 });
    if (scaffold.minRole === 'admin' && userRole !== 'admin') {
      throw Object.assign(new Error(`Admin role required for scaffold: ${normalized}`), { statusCode: 403 });
    }
  }

  /**
   * Creates a deck folder by copying the v1 scaffold.
   */
  async create(input: { title?: string; markdown?: string; scaffold?: string; ownerUserId?: string }): Promise<DeckRecord> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const scaffoldKey = normalizeScaffoldKey(input.scaffold) ?? this.config.scaffoldKey;
    await this.assertScaffoldExists(scaffoldKey);
    const isHtmlRuntime = await this.isHtmlScaffold(scaffoldKey);
    const title = normalizeTitle(input.title) ?? inferTitle(input.markdown) ?? 'Untitled deck';
    const markdown = input.markdown ?? setSlidevTitle((await this.scaffoldMarkdown(scaffoldKey)).replaceAll('Slidev Agent Platform', title), title);
    const orgId = await this.configuredOrgId();
    const meta: DeckMeta = {
      id,
      orgId,
      title,
      scaffoldKey,
      ownerUserId: input.ownerUserId,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      visibility: 'private',
      draftUrl: isHtmlRuntime ? `/runtime/${id}/#/1` : `/draft/${id}/#/1`,
    };

    await fs.cp(this.scaffoldDir(scaffoldKey), this.deckDir(id), { recursive: true, force: false });
    await this.linkRuntimeDependencies(id);
    if (isHtmlRuntime) await this.applyDeckManifestTitle(id, title);
    await writeText(this.deckFile(id), markdown);
    if (this.pool) await this.insertMeta(meta, input.ownerUserId ?? 'system');
    else await writeJson(this.metaFile(id), meta);
    return { meta, markdown };
  }

  /**
   * Registers an existing Slidev project directory as a new rough imported deck.
   */
  async createFromProject(input: { title?: string; projectDir: string; ownerUserId?: string; scaffoldKey?: string }): Promise<DeckRecord> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const targetDir = this.deckDir(id);
    await fs.cp(input.projectDir, targetDir, { recursive: true, force: false });
    await this.linkRuntimeDependencies(id);

    const markdownPath = this.deckFile(id);
    const markdown = await readRequiredText(markdownPath, 'Imported deck');
    const title = normalizeTitle(input.title) ?? inferTitle(markdown) ?? inferSlidevTitle(markdown) ?? 'Imported PPTX deck';
    const updatedMarkdown = setSlidevTitle(markdown, title);
    const orgId = await this.configuredOrgId();
    const meta: DeckMeta = {
      id,
      orgId,
      title,
      scaffoldKey: input.scaffoldKey ?? 'pptx-import',
      ownerUserId: input.ownerUserId,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      visibility: 'private',
      draftUrl: `/draft/${id}/#/1`,
      messages: [{
        role: 'agent',
        content: 'Imported from PPTX. This is a rough conversion; use the agent to refine layout and copy.',
        createdAt: now,
      }],
    };

    await writeText(markdownPath, updatedMarkdown);
    if (this.pool) await this.insertMeta(meta, input.ownerUserId ?? 'system');
    else await writeJson(this.metaFile(id), meta);
    return { meta, markdown: updatedMarkdown };
  }

  /**
   * Returns a deck with metadata and markdown.
   */
  async get(id: string): Promise<DeckRecord> {
    this.assertDeckId(id);
    const [meta, markdown] = await Promise.all([this.readMeta(id), readRequiredText(this.deckFile(id), 'Deck')]);
    return { meta, markdown };
  }

  /**
   * Updates deck title and/or markdown while preserving folder identity.
   */
  async update(id: string, input: { title?: string; markdown?: string }): Promise<DeckRecord> {
    const current = await this.get(id);
    const title = normalizeTitle(input.title) ?? current.meta.title;
    const markdown = input.markdown ?? current.markdown;
    const meta: DeckMeta = {
      ...current.meta,
      title,
      updatedAt: new Date().toISOString(),
    };

    await Promise.all([
      writeText(this.deckFile(id), markdown),
      this.writeMeta(meta),
    ]);
    return { meta, markdown };
  }

  /**
   * Acquires the v1 single-active-editor lock for a deck.
   */
  async acquireEditLock(id: string, userId: string): Promise<DeckMeta> {
    this.assertDeckId(id);
    if (this.pool) {
      const result = await this.pool.query(
        `
          update deck
          set active_editor_user_id = $2,
              updated_at = now()
          where id = $1
            and (active_editor_user_id is null or active_editor_user_id = $2)
          returning *
        `,
        [id, userId],
      );
      if (result.rowCount) return rowToMeta(result.rows[0]);
      const current = await this.readMeta(id);
      throw Object.assign(new Error('Deck is locked by another editor'), {
        statusCode: 409,
        activeEditorUserId: current.activeEditorUserId,
      });
    }

    const current = await this.readMeta(id);
    if (current.activeEditorUserId && current.activeEditorUserId !== userId) {
      throw Object.assign(new Error('Deck is locked by another editor'), {
        statusCode: 409,
        activeEditorUserId: current.activeEditorUserId,
      });
    }
    return this.updateMeta(id, { activeEditorUserId: userId });
  }

  /**
   * Releases the v1 single-active-editor lock if held by the current user.
   */
  async releaseEditLock(id: string, userId: string): Promise<DeckMeta> {
    this.assertDeckId(id);
    if (this.pool) {
      const result = await this.pool.query(
        `
          update deck
          set active_editor_user_id = null,
              updated_at = now()
          where id = $1
            and active_editor_user_id = $2
          returning *
        `,
        [id, userId],
      );
      if (result.rowCount) return rowToMeta(result.rows[0]);
      return this.readMeta(id);
    }

    const current = await this.readMeta(id);
    if (current.activeEditorUserId !== userId) return current;
    return this.updateMeta(id, { activeEditorUserId: undefined });
  }

  /**
   * Throws unless the deck is unlocked or locked by this user.
   */
  async requireEditLock(id: string, userId: string): Promise<void> {
    const meta = await this.readMeta(id);
    if (!meta.activeEditorUserId || meta.activeEditorUserId === userId) return;
    throw Object.assign(new Error('Deck is locked by another editor'), {
      statusCode: 409,
      activeEditorUserId: meta.activeEditorUserId,
    });
  }

  /**
   * Deletes a deck folder recursively.
   */
  async delete(id: string): Promise<void> {
    this.assertDeckId(id);
    await fs.rm(this.deckDir(id), { recursive: true, force: true });
    if (this.pool) {
      await this.pool.query('delete from deck where id = $1', [id]);
    }
  }

  /**
   * Patches metadata without changing deck markdown.
   */
  async updateMeta(id: string, patch: Partial<DeckMeta>): Promise<DeckMeta> {
    const current = await this.readMeta(id);
    const meta = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: new Date().toISOString(),
    };
    await this.writeMeta(meta);
    return meta;
  }

  /**
   * Returns the canonical markdown file path for a deck.
   */
  deckFile(id: string): string {
    this.assertDeckId(id);
    return path.join(this.deckDir(id), 'slides.md');
  }

  /**
   * Returns the deck folder path for local services.
   */
  deckPath(id: string): string {
    this.assertDeckId(id);
    return this.deckDir(id);
  }

  private async readMeta(id: string): Promise<DeckMeta> {
    this.assertDeckId(id);
    if (this.pool) {
      const result = await this.pool.query('select * from deck where id = $1', [id]);
      if (!result.rowCount) throw Object.assign(new Error('Deck not found'), { statusCode: 404 });
      return rowToMeta(result.rows[0]);
    }
    return readRequiredJson<DeckMeta>(this.metaFile(id), 'Deck');
  }

  private async writeMeta(meta: DeckMeta): Promise<void> {
    if (!this.pool) {
      await writeJson(this.metaFile(meta.id), meta);
      return;
    }

    await this.pool.query(
      `
        update deck
        set title = $2,
            scaffold_key = $3,
            owner_user_id = $4,
            visibility = $5,
            draft_url = $6,
            share_token = $7,
            active_editor_user_id = $8,
            status = $9,
            publish_url = $10,
            published_at = $11,
            metadata = $12,
            updated_at = $13
        where id = $1
      `,
      [
        meta.id,
        meta.title,
        meta.scaffoldKey ?? this.config.scaffoldKey,
        meta.ownerUserId ?? 'system',
        meta.visibility,
        meta.draftUrl,
        meta.shareToken ?? null,
        meta.activeEditorUserId ?? null,
        meta.status,
        meta.publishUrl ?? null,
        meta.publishedAt ?? null,
        JSON.stringify({ messages: meta.messages ?? [], agent: meta.agent ?? null, pptx: meta.pptx ?? null }),
        meta.updatedAt,
      ],
    );
  }

  private async insertMeta(meta: DeckMeta, ownerUserId: string): Promise<void> {
    if (!this.pool) return;
    const orgId = meta.orgId ?? await this.configuredOrgId();
    if (!orgId) throw new Error('Configured organization is not available');
    await this.pool.query(
      `
        insert into deck (
          id, org_id, owner_user_id, title, slug, scaffold_key, visibility, draft_url,
          share_token, active_editor_user_id, status, fs_path, subdomain, publish_url, published_at, metadata,
          created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18
        )
      `,
      [
        meta.id,
        orgId,
        ownerUserId,
        meta.title,
        slugify(meta.title),
        meta.scaffoldKey ?? this.config.scaffoldKey,
        meta.visibility,
        meta.draftUrl,
        meta.shareToken ?? null,
        meta.activeEditorUserId ?? null,
        meta.status,
        this.deckDir(meta.id),
        meta.id,
        meta.publishUrl ?? null,
        meta.publishedAt ?? null,
        JSON.stringify({ messages: meta.messages ?? [], agent: meta.agent ?? null, pptx: meta.pptx ?? null }),
        meta.createdAt,
        meta.updatedAt,
      ],
    );
  }

  async configuredOrgId(): Promise<string | undefined> {
    if (!this.pool) return undefined;
    this.configuredOrgIdPromise ??= this.ensureConfiguredOrg();
    return this.configuredOrgIdPromise;
  }

  private async ensureConfiguredOrg(): Promise<string> {
    if (!this.pool) throw new Error('Postgres pool is not configured');
    const result = await this.pool.query(
      `
        insert into org(name, slug)
        values ($1, $2)
        on conflict (slug) do update set name = excluded.name
        returning id
      `,
      [this.config.auth.organizationName, this.config.auth.organizationSlug],
    );
    return result.rows[0].id;
  }

  private metaFile(id: string): string {
    return path.join(this.deckDir(id), 'meta.json');
  }

  private deckDir(id: string): string {
    this.assertDeckId(id);
    return path.join(this.config.decksDir, id);
  }

  private scaffoldDir(scaffoldKey = this.config.scaffoldKey): string {
    const key = normalizeScaffoldKey(scaffoldKey) ?? 'commercial-profile';
    return path.join(this.config.repoRoot, 'themes', key);
  }

  private async scaffoldMarkdown(scaffoldKey: string): Promise<string> {
    return readText(path.join(this.scaffoldDir(scaffoldKey), 'slides.md'), DEFAULT_MARKDOWN);
  }

  private async assertScaffoldExists(scaffoldKey: string): Promise<void> {
    try {
      const stat = await fs.stat(this.scaffoldDir(scaffoldKey));
      if (stat.isDirectory()) return;
    } catch (error) {
      if (!isNodeErrorCode(error, 'ENOENT')) throw error;
    }
    throw Object.assign(new Error(`Scaffold not found: ${scaffoldKey}`), { statusCode: 404 });
  }

  private async isHtmlScaffold(scaffoldKey: string): Promise<boolean> {
    try {
      await fs.access(path.join(this.scaffoldDir(scaffoldKey), 'deck.json'));
      return true;
    } catch {
      return false;
    }
  }

  private async applyDeckManifestTitle(id: string, title: string): Promise<void> {
    const manifestPath = path.join(this.deckDir(id), 'deck.json');
    try {
      const manifest = JSON.parse(await readRequiredText(manifestPath, 'Deck manifest')) as Record<string, unknown>;
      manifest.title = title;
      await writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch {
      // A scaffold without a valid manifest still works; the runtime falls back gracefully.
    }
  }

  private async linkRuntimeDependencies(id: string): Promise<void> {
    const source = path.join(this.config.repoRoot, 'node_modules');
    const target = path.join(this.deckDir(id), 'node_modules');
    try {
      await fs.access(source);
      await fs.symlink(source, target, 'dir');
    } catch (error) {
      if (isIgnorableLinkError(error)) return;
      throw error;
    }
  }

  private assertDeckId(id: string): void {
    if (!/^[a-f0-9-]{36}$/i.test(id)) {
      throw Object.assign(new Error('Invalid deck id'), { statusCode: 400 });
    }
  }
}

function isIgnorableLinkError(error: unknown): boolean {
  return isNodeErrorCode(error, 'ENOENT') || isNodeErrorCode(error, 'EEXIST');
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value.trim();
  return title.length > 0 ? title.slice(0, 160) : undefined;
}

function inferTitle(markdown: unknown): string | undefined {
  if (typeof markdown !== 'string') return undefined;
  const heading = markdown.match(/^#\s+(.+)$/m);
  return normalizeTitle(heading?.[1]);
}

function inferSlidevTitle(markdown: string): string | undefined {
  if (!markdown.startsWith('---')) return undefined;
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return undefined;
  const match = markdown.slice(0, end).match(/^title:\s*["']?(.+?)["']?\s*$/m);
  return normalizeTitle(match?.[1]);
}

function normalizeScaffoldKey(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value.trim();
  if (!key) return undefined;
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(key)) {
    throw Object.assign(new Error('Invalid scaffold key'), { statusCode: 400 });
  }
  return key;
}

function setSlidevTitle(markdown: string, title: string): string {
  if (!markdown.startsWith('---')) return markdown;
  const end = markdown.indexOf('\n---', 3);
  if (end < 0) return markdown;
  const frontmatter = markdown.slice(0, end);
  const quotedTitle = JSON.stringify(title);
  if (/^title:\s*.*$/m.test(frontmatter)) {
    return `${frontmatter.replace(/^title:\s*.*$/m, `title: ${quotedTitle}`)}${markdown.slice(end)}`;
  }
  return `${frontmatter}\ntitle: ${quotedTitle}${markdown.slice(end)}`;
}

function rowToMeta(row: Record<string, unknown>): DeckMeta {
  const metadata = asMetadata(row.metadata);
  return {
    id: String(row.id),
    orgId: typeof row.org_id === 'string' ? row.org_id : undefined,
    title: String(row.title),
    scaffoldKey: typeof row.scaffold_key === 'string' ? row.scaffold_key : undefined,
    ownerUserId: typeof row.owner_user_id === 'string' ? row.owner_user_id : undefined,
    status: row.status === 'published' ? 'published' : 'draft',
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    visibility: normalizeVisibility(row.visibility),
    draftUrl: String(row.draft_url ?? `/draft/${row.id}/#/1`),
    shareToken: typeof row.share_token === 'string' ? row.share_token : undefined,
    activeEditorUserId: typeof row.active_editor_user_id === 'string' ? row.active_editor_user_id : undefined,
    publishedAt: row.published_at ? iso(row.published_at) : undefined,
    publishUrl: typeof row.publish_url === 'string' ? row.publish_url : undefined,
    messages: Array.isArray(metadata.messages) ? metadata.messages as DeckMeta['messages'] : undefined,
    agent: metadata.agent && typeof metadata.agent === 'object' ? normalizeAgentMetadata(metadata.agent) : undefined,
    pptx: metadata.pptx && typeof metadata.pptx === 'object' ? metadata.pptx as DeckMeta['pptx'] : undefined,
  };
}

function normalizeAgentMetadata(value: object): DeckMeta['agent'] | undefined {
  const record = value as Record<string, unknown>;
  const agent: NonNullable<DeckMeta['agent']> = {};
  if (typeof record.baseUrl === 'string' && record.baseUrl.trim()) agent.baseUrl = record.baseUrl.trim();
  if (typeof record.memberModel === 'string' && record.memberModel.trim()) agent.memberModel = record.memberModel.trim();
  if (typeof record.adminModel === 'string' && record.adminModel.trim()) agent.adminModel = record.adminModel.trim();
  if (typeof record.timeoutMs === 'number' && Number.isInteger(record.timeoutMs) && record.timeoutMs > 0) agent.timeoutMs = record.timeoutMs;
  return Object.keys(agent).length ? agent : undefined;
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeVisibility(value: unknown): DeckMeta['visibility'] {
  if (value === 'shared' || value === 'published') return value;
  return 'private';
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'deck';
}

function parsePackageDetails(value: string): { name?: string; description?: string } {
  try {
    const parsed = JSON.parse(value);
    return {
      name: typeof parsed.name === 'string' ? labelFromPackageName(parsed.name) : undefined,
      description: typeof parsed.description === 'string' ? parsed.description : undefined,
    };
  } catch {
    return {};
  }
}

function labelFromPackageName(value: string): string {
  return labelFromKey(value.split('/').pop() ?? value);
}

function labelFromKey(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}
