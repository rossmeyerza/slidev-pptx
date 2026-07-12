import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppConfig, DeckMeta, DeckRecord, ScaffoldRecord, UserRole } from '../core/types.js';
import { readRequiredJson, readRequiredText, readText, writeJson, writeText } from '../core/storage.js';
import type { PgPool } from '../db/db.js';
import { SettingsService } from './settings.js';

const SNAPSHOT_ROOTS = ['deck.json', 'theme.css', 'slides', 'assets', 'public'] as const;

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
    const themesRoot = path.join(this.config.repoRoot, 'themes');
    const templatesRoot = path.join(this.config.dataDir, 'templates');
    const roots = [
      { root: themesRoot, priority: 0 },
      { root: templatesRoot, priority: 1 },
    ];
    const discovered = new Map<string, { root: string; priority: number }>();
    for (const candidate of roots) {
      const entries = await fs.readdir(candidate.root, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const key = normalizeScaffoldKey(entry.name);
        if (key && !discovered.has(key)) discovered.set(key, candidate);
      }
    }
    const settings = await new SettingsService(this.config).load();
    const configured = settings.scaffolds?.items ?? {};
    const defaultKey = settings.scaffolds?.defaultKey ?? this.config.scaffoldKey;
    const scaffolds = await Promise.all([...discovered.entries()].map(async ([key, source]) => {
        const overrides = configured[key] ?? {};
        const isActive = overrides.isActive ?? await fs.access(path.join(source.root, key, 'deck.json')).then(() => true).catch(() => false);
        const minRole = overrides.minRole ?? 'employee';
        if (!input.includeInactive && !isActive) return null;
        if (input.userRole !== 'admin' && minRole === 'admin') return null;
        const packageJson = await readText(path.join(source.root, key, 'package.json'), '{}');
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
  async create(input: { title?: string; scaffold?: string; ownerUserId?: string }): Promise<DeckRecord> {
    const now = new Date().toISOString();
    const id = randomUUID();
    const scaffoldKey = normalizeScaffoldKey(input.scaffold) ?? this.config.scaffoldKey;
    await this.assertScaffoldExists(scaffoldKey);
    const title = normalizeTitle(input.title) ?? 'Untitled deck';
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
      draftUrl: `/runtime/${id}/#/1`,
    };

    await fs.cp(this.scaffoldDir(scaffoldKey), this.deckDir(id), { recursive: true, force: false });
    await this.linkRuntimeDependencies(id);
    await this.stampRuntimeShell(id);
    await this.applyDeckManifestTitle(id, title);
    if (this.pool) await this.insertMeta(meta, input.ownerUserId ?? 'system');
    else await writeJson(this.metaFile(id), meta);
    return { meta, markdown: '' };
  }

  /**
   * Returns a deck with metadata.
   */
  async get(id: string): Promise<DeckRecord> {
    this.assertDeckId(id);
    return { meta: await this.readMeta(id), markdown: '' };
  }

  /**
   * Updates a deck title while preserving folder identity.
   */
  async update(id: string, input: { title?: string }): Promise<DeckRecord> {
    const current = await this.get(id);
    const title = normalizeTitle(input.title) ?? current.meta.title;
    const meta: DeckMeta = {
      ...current.meta,
      title,
      updatedAt: new Date().toISOString(),
    };

    await this.writeMeta(meta);
    if (title !== current.meta.title && await this.isHtmlDeck(id)) {
      await this.applyDeckManifestTitle(id, title, false);
    }
    return { meta, markdown: '' };
  }

  async duplicate(id: string, ownerUserId: string): Promise<DeckRecord> {
    const source = await this.get(id);
    const now = new Date().toISOString();
    const newId = randomUUID();
    await fs.cp(this.deckDir(id), this.deckDir(newId), {
      recursive: true,
      force: false,
      filter: (entry) => !['.snapshots', 'node_modules', 'dist', '.git'].includes(path.basename(entry)),
    });
    const meta: DeckMeta = {
      id: newId,
      orgId: await this.configuredOrgId(),
      title: `Copy of ${source.meta.title}`,
      scaffoldKey: source.meta.scaffoldKey,
      ownerUserId,
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      visibility: 'private',
      draftUrl: `/runtime/${newId}/#/1`,
    };
    await this.linkRuntimeDependencies(newId);
    await this.applyDeckManifestTitle(newId, meta.title, false);
    if (this.pool) await this.insertMeta(meta, ownerUserId);
    else await writeJson(this.metaFile(newId), meta);
    return { meta, markdown: '' };
  }

  async saveAsTemplate(id: string, input: { name: string; description?: string }): Promise<ScaffoldRecord> {
    await this.get(id);
    if (!await this.isHtmlDeck(id)) throw Object.assign(new Error('Only HTML runtime decks can be saved as templates'), { statusCode: 400 });
    const key = slugify(input.name);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw Object.assign(new Error('Invalid template name'), { statusCode: 400 });
    const themeDir = path.join(this.config.repoRoot, 'themes', key);
    const target = path.join(this.config.dataDir, 'templates', key);
    if (existsSync(themeDir) || existsSync(target)) throw Object.assign(new Error(`Scaffold already exists: ${key}`), { statusCode: 403 });
    await fs.mkdir(target, { recursive: false });
    const source = this.deckDir(id);
    for (const name of ['theme.css', 'slides', 'assets', 'public', 'index.html', 'runtime.js', 'runtime.css']) {
      const from = path.join(source, name);
      const stat = await fs.lstat(from).catch(() => undefined);
      if (stat) await fs.cp(from, path.join(target, name), { recursive: stat.isDirectory(), force: false });
    }
    const manifest = JSON.parse(await readRequiredText(path.join(source, 'deck.json'), 'Deck manifest')) as Record<string, unknown>;
    manifest.title = 'Untitled deck';
    await writeText(path.join(target, 'deck.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    await writeJson(path.join(target, 'package.json'), { name: input.name.trim(), description: input.description?.trim() ?? '', private: true, version: '1.0.0' });
    return (await this.listScaffolds({ includeInactive: true, userRole: 'admin' })).find((item) => item.key === key)!;
  }

  async editableFiles(id: string): Promise<{ path: string; size: number }[]> {
    await this.get(id);
    const paths = await this.editableFilePaths(id);
    const files = await Promise.all(paths.map(async (relativePath) => ({
      path: relativePath,
      size: (await fs.stat(path.join(this.deckDir(id), relativePath))).size,
    })));
    return files;
  }

  async readEditableFile(id: string, relativePath: string): Promise<string> {
    await this.assertEditableFile(id, relativePath);
    const file = path.join(this.deckDir(id), relativePath);
    const stat = await fs.stat(file);
    if (stat.size > 1024 * 1024) throw Object.assign(new Error('File exceeds the 1 MB limit'), { statusCode: 413 });
    return fs.readFile(file, 'utf8');
  }

  async writeEditableFile(id: string, relativePath: string, content: string): Promise<void> {
    await this.assertEditableFile(id, relativePath);
    if (Buffer.byteLength(content) > 1024 * 1024) throw Object.assign(new Error('File exceeds the 1 MB limit'), { statusCode: 413 });
    if (relativePath === 'deck.json') {
      try { JSON.parse(content); } catch { throw Object.assign(new Error('Invalid deck.json JSON'), { statusCode: 400 }); }
    }
    await writeText(path.join(this.deckDir(id), relativePath), content);
    await this.updateMeta(id, {});
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

  /** Copies all agent-editable deck content into a retained local snapshot. */
  async snapshotDeck(id: string): Promise<string> {
    this.assertDeckId(id);
    const snapshotId = `${snapshotTimestamp()}-${randomUUID().slice(0, 8)}`;
    const snapshotDir = path.join(this.deckDir(id), '.snapshots', snapshotId);
    await fs.mkdir(snapshotDir, { recursive: true });
    for (const root of SNAPSHOT_ROOTS) {
      const source = path.join(this.deckDir(id), root);
      const target = path.join(snapshotDir, root);
      await copySnapshotEntry(source, target);
    }
    const snapshotRoot = path.join(this.deckDir(id), '.snapshots');
    const entries = await fs.readdir(snapshotRoot, { withFileTypes: true });
    const older = entries
      .filter((entry) => entry.isDirectory() && isSnapshotId(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left))
      .slice(10);
    await Promise.all(older.map((entry) => fs.rm(path.join(snapshotRoot, entry), { recursive: true, force: true })));
    return snapshotId;
  }

  /** Lists retained snapshots newest first. */
  async listSnapshots(id: string): Promise<{ id: string; createdAt: string }[]> {
    this.assertDeckId(id);
    const root = path.join(this.deckDir(id), '.snapshots');
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    const snapshots = await Promise.all(entries.filter((entry) => entry.isDirectory() && isSnapshotId(entry.name)).map(async (entry) => ({
      id: entry.name,
      createdAt: (await fs.stat(path.join(root, entry.name))).mtime.toISOString(),
    })));
    return snapshots.sort((left, right) => right.id.localeCompare(left.id)).slice(0, 10);
  }

  /** Restores the editable set exactly as captured by a retained snapshot. */
  async revertToSnapshot(id: string, snapshotId?: string): Promise<void> {
    this.assertDeckId(id);
    const selected = snapshotId ?? (await this.listSnapshots(id))[0]?.id;
    if (!selected || !isSnapshotId(selected)) throw Object.assign(new Error('Snapshot not found'), { statusCode: 404 });
    const snapshotDir = path.join(this.deckDir(id), '.snapshots', selected);
    const exists = await fs.stat(snapshotDir).then((stat) => stat.isDirectory()).catch(() => false);
    if (!exists) throw Object.assign(new Error('Snapshot not found'), { statusCode: 404 });
    for (const root of SNAPSHOT_ROOTS) {
      const target = path.join(this.deckDir(id), root);
      await fs.rm(target, { recursive: true, force: true });
      await copySnapshotEntry(path.join(snapshotDir, root), target);
    }
    await this.updateMeta(id, {});
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

  /** Patches deck metadata. */
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
   * Returns the deck folder path for local services.
   */
  deckPath(id: string): string {
    this.assertDeckId(id);
    return this.deckDir(id);
  }

  private async editableFilePaths(id: string): Promise<string[]> {
    const manifest = JSON.parse(await readRequiredText(path.join(this.deckDir(id), 'deck.json'), 'Deck manifest')) as { slides?: unknown };
    const slides = Array.isArray(manifest.slides) ? manifest.slides.filter((value): value is string => typeof value === 'string' && /^slides\/[^/]+\.html$/.test(value)) : [];
    return ['deck.json', 'theme.css', ...slides];
  }

  private async assertEditableFile(id: string, relativePath: string): Promise<void> {
    if (!(await this.editableFilePaths(id)).includes(relativePath)) throw Object.assign(new Error('File not found'), { statusCode: 404 });
  }

  private async isHtmlDeck(id: string): Promise<boolean> {
    return fs.access(path.join(this.deckDir(id), 'deck.json')).then(() => true).catch(() => false);
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
    const key = normalizeScaffoldKey(scaffoldKey) ?? 'custom-html';
    const theme = path.join(this.config.repoRoot, 'themes', key);
    return existsSync(theme) ? theme : path.join(this.config.dataDir, 'templates', key);
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

  /**
   * Copies the canonical runtime shell into the deck folder. Serving always
   * uses the canonical copy (`runtime/` at the repo root); the stamped files
   * keep deck folders self-contained for export and offline viewing.
   */
  private async stampRuntimeShell(id: string): Promise<void> {
    const shellDir = path.join(this.config.repoRoot, 'runtime');
    for (const name of ['index.html', 'runtime.js', 'runtime.css']) {
      await fs.copyFile(path.join(shellDir, name), path.join(this.deckDir(id), name)).catch((error) => {
        if (!isNodeErrorCode(error, 'ENOENT')) throw error;
      });
    }
  }

  private async applyDeckManifestTitle(id: string, title: string, stampSlidePlaceholders = true): Promise<void> {
    const manifestPath = path.join(this.deckDir(id), 'deck.json');
    try {
      const manifest = JSON.parse(await readRequiredText(manifestPath, 'Deck manifest')) as Record<string, unknown>;
      manifest.title = title;
      await writeText(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    } catch {
      // A scaffold without a valid manifest still works; the runtime falls back gracefully.
    }
    // Scaffold slides carry the "Untitled deck" placeholder; stamp the real
    // title into slide copy so the cover matches the deck from the start.
    if (!stampSlidePlaceholders) return;
    const slidesDir = path.join(this.deckDir(id), 'slides');
    const entries = await fs.readdir(slidesDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.html')) continue;
      const slidePath = path.join(slidesDir, entry.name);
      const content = await fs.readFile(slidePath, 'utf8').catch(() => '');
      if (!content.includes('Untitled deck')) continue;
      await writeText(slidePath, content.replaceAll('Untitled deck', escapeHtmlText(title)));
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

function snapshotTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function isSnapshotId(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/i.test(value);
}

async function copySnapshotEntry(source: string, target: string): Promise<void> {
  const exists = await fs.lstat(source).catch(() => undefined);
  if (!exists) return;
  await fs.cp(source, target, {
    recursive: true,
    force: false,
    filter: (entry) => {
      const name = path.basename(entry);
      return !name.startsWith('.') && name !== 'node_modules' && name !== 'dist';
    },
  });
}

function isIgnorableLinkError(error: unknown): boolean {
  return isNodeErrorCode(error, 'ENOENT') || isNodeErrorCode(error, 'EEXIST');
}

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === code;
}

function normalizeTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const title = value.trim();
  return title.length > 0 ? title.slice(0, 160) : undefined;
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
    draftUrl: String(row.draft_url ?? `/runtime/${row.id}/#/1`),
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
