import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { migrations } from './migrations.js';

export const DEFAULT_DATABASE_PATH = '.hexzero/experiments.sqlite';
export const LEGACY_DATABASE_PATH = '.agentborne/experiments.sqlite';
export const DATABASE_PATH_ENV = 'HEXZERO_EXPERIMENT_DB';
export const LEGACY_DATABASE_PATH_ENV = 'AGENTBORNE_EXPERIMENT_DB';

export function archiveInvocationRoot(): string {
  return process.env.INIT_CWD?.trim() || process.cwd();
}

export interface OpenArchiveOptions {
  path?: string;
  clock?: () => Date;
  environment?: NodeJS.ProcessEnv;
  warn?: (message: string) => void;
}

export interface ResolvedArchivePath {
  path: string;
  source:
    'cli' | 'environment' | 'legacy-environment' | 'default' | 'legacy-default';
}

export function resolveArchivePath(
  options: Pick<OpenArchiveOptions, 'path' | 'environment'> = {},
): ResolvedArchivePath {
  if (options.path !== undefined) return { path: options.path, source: 'cli' };
  const environment = options.environment ?? process.env;
  if (environment[DATABASE_PATH_ENV] !== undefined)
    return { path: environment[DATABASE_PATH_ENV]!, source: 'environment' };
  if (environment[LEGACY_DATABASE_PATH_ENV] !== undefined)
    return {
      path: environment[LEGACY_DATABASE_PATH_ENV]!,
      source: 'legacy-environment',
    };
  const root = archiveInvocationRoot();
  if (existsSync(resolve(root, DEFAULT_DATABASE_PATH)))
    return { path: DEFAULT_DATABASE_PATH, source: 'default' };
  if (existsSync(resolve(root, LEGACY_DATABASE_PATH)))
    return { path: LEGACY_DATABASE_PATH, source: 'legacy-default' };
  return { path: DEFAULT_DATABASE_PATH, source: 'default' };
}

export class ArchivePersistenceError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ArchivePersistenceError';
  }
}

export class ArchiveDatabase {
  readonly database: DatabaseSync;
  readonly path: string;
  readonly clock: () => Date;

  constructor(options: OpenArchiveOptions = {}) {
    const configured = resolveArchivePath(options);
    if (configured.source === 'legacy-environment')
      (options.warn ?? console.warn)(
        `${LEGACY_DATABASE_PATH_ENV} is deprecated; use ${DATABASE_PATH_ENV}. Continuing with the legacy setting.`,
      );
    if (configured.source === 'legacy-default')
      (options.warn ?? console.warn)(
        `Using the existing legacy archive at ${LEGACY_DATABASE_PATH}. Optionally move it to ${DEFAULT_DATABASE_PATH} while Hex Zero is stopped.`,
      );
    this.path =
      configured.path === ':memory:'
        ? configured.path
        : resolve(archiveInvocationRoot(), configured.path);
    this.clock = options.clock ?? (() => new Date());
    try {
      if (this.path !== ':memory:')
        mkdirSync(dirname(this.path), { recursive: true });
      this.database = new DatabaseSync(this.path);
      this.database.exec(
        'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;',
      );
      if (this.path !== ':memory:')
        this.database.exec('PRAGMA journal_mode = WAL;');
      this.migrate();
    } catch (error) {
      throw new ArchivePersistenceError(
        `Could not open experiment archive at ${this.path}.`,
        error,
      );
    }
  }

  close(): void {
    this.database.close();
  }

  transaction<T>(operation: () => T): T {
    try {
      this.database.exec('BEGIN IMMEDIATE');
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.database.exec('ROLLBACK');
      } catch {
        // Preserve the original persistence failure.
      }
      if (error instanceof ArchivePersistenceError) throw error;
      throw new ArchivePersistenceError(
        'Experiment archive transaction failed and was rolled back.',
        error,
      );
    }
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        description TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const rows = this.database
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    const applied = new Set(rows.map(({ version }) => version));
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.transaction(() => {
        this.database.exec(migration.sql);
        this.database
          .prepare(
            'INSERT INTO schema_migrations(version, description, applied_at) VALUES (?, ?, ?)',
          )
          .run(
            migration.version,
            migration.description,
            this.clock().toISOString(),
          );
      });
    }
  }
}
