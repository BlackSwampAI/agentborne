import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { ArchiveDatabase, archiveInvocationRoot } from './database.js';
import { assertSafeArchiveValue } from './importer.js';
import {
  DEFAULT_DETAIL_LIMIT,
  MAX_DETAIL_LIMIT,
  type QueryPage,
} from './query-service.js';

export const NOTE_TYPES = [
  'transcript',
  'observation',
  'hypothesis',
  'decision',
  'implementation-note',
  'experiment-finding',
] as const;
export const NOTE_STATUSES = [
  'proposed',
  'accepted',
  'rejected',
  'deferred',
  'superseded',
] as const;
export type NoteType = (typeof NOTE_TYPES)[number];
export type NoteStatus = (typeof NOTE_STATUSES)[number];

export interface NoteImportOptions {
  type: NoteType;
  status: NoteStatus;
  title?: string;
  tags?: string[];
  provenance?: string;
  experiments?: string[];
  supersedes?: string;
}

export interface NoteFilters {
  type?: NoteType;
  status?: NoteStatus;
  tag?: string;
  experiment?: string;
  limit?: number;
}

function normalizeList(values: readonly string[] = []): string[] {
  return [
    ...new Set(
      values.map((value) => value.trim().toLowerCase()).filter(Boolean),
    ),
  ].sort();
}

function limit(value?: number): number {
  if (value === undefined) return DEFAULT_DETAIL_LIMIT;
  if (!Number.isInteger(value) || value < 1)
    throw new Error('Limit must be a positive integer.');
  return Math.min(value, MAX_DETAIL_LIMIT);
}

function extractTitle(body: string, fallback: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallback.replace(/\.md$/i, '');
}

export class ResearchNoteService {
  constructor(readonly archive: ArchiveDatabase) {}

  import(
    file: string,
    options: NoteImportOptions,
  ): { id: string; inserted: boolean } {
    if (!NOTE_TYPES.includes(options.type))
      throw new Error(`Unsupported note type: ${options.type}`);
    if (!NOTE_STATUSES.includes(options.status))
      throw new Error(`Unsupported note status: ${options.status}`);
    const sourcePath = resolve(archiveInvocationRoot(), file);
    const body = readFileSync(sourcePath, 'utf8').trim();
    if (!body) throw new Error('A research note cannot be empty.');
    assertSafeArchiveValue(body, '$.note.body');
    const title = (options.title ?? extractTitle(body, basename(file))).trim();
    if (!title) throw new Error('A research note requires a title.');
    const tags = normalizeList(options.tags);
    const experiments = normalizeList(options.experiments);
    const provenance = options.provenance?.trim() || basename(sourcePath);
    assertSafeArchiveValue({ title, body, tags, provenance }, '$.note');
    const id = createHash('sha256')
      .update(JSON.stringify({ title, body, type: options.type, provenance }))
      .digest('hex');
    const timestamp = this.archive.clock().toISOString();
    return this.archive.transaction(() => {
      const result = this.archive.database
        .prepare(
          `
          INSERT OR IGNORE INTO notes(
            id, title, body, type, status, provenance, superseded_note_id,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id,
          title,
          body,
          options.type,
          options.status,
          provenance,
          options.supersedes ?? null,
          timestamp,
          timestamp,
        );
      if (result.changes === 0) return { id, inserted: false };
      const tagStatement = this.archive.database.prepare(
        'INSERT INTO note_tags(note_id, tag) VALUES (?, ?)',
      );
      for (const tag of tags) tagStatement.run(id, tag);
      const experimentStatement = this.archive.database.prepare(
        'INSERT INTO note_experiments(note_id, experiment_id) VALUES (?, ?)',
      );
      for (const experiment of experiments)
        experimentStatement.run(id, experiment);
      this.archive.database
        .prepare(
          'INSERT INTO notes_fts(note_id, title, body, tags) VALUES (?, ?, ?, ?)',
        )
        .run(id, title, body, tags.join(' '));
      if (options.supersedes)
        this.archive.database
          .prepare(
            "UPDATE notes SET status = 'superseded', updated_at = ? WHERE id = ?",
          )
          .run(timestamp, options.supersedes);
      return { id, inserted: true };
    });
  }

  list(filters: NoteFilters = {}): QueryPage<Record<string, unknown>> {
    return this.query(undefined, filters);
  }

  search(
    query: string,
    filters: NoteFilters = {},
  ): QueryPage<Record<string, unknown>> {
    const terms = query.trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0)
      throw new Error('A note search query cannot be empty.');
    const safeQuery = terms
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(' AND ');
    return this.query(safeQuery, filters);
  }

  private query(
    search: string | undefined,
    filters: NoteFilters,
  ): QueryPage<Record<string, unknown>> {
    const bounded = limit(filters.limit);
    const clauses: string[] = [];
    const values: Array<string | number> = [];
    if (filters.type) {
      clauses.push('n.type = ?');
      values.push(filters.type);
    }
    if (filters.status) {
      clauses.push('n.status = ?');
      values.push(filters.status);
    }
    if (filters.tag) {
      clauses.push(
        'EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag = ?)',
      );
      values.push(filters.tag.toLowerCase());
    }
    if (filters.experiment) {
      clauses.push(
        'EXISTS (SELECT 1 FROM note_experiments ne WHERE ne.note_id = n.id AND ne.experiment_id = ?)',
      );
      values.push(filters.experiment);
    }
    if (search) {
      clauses.push('notes_fts MATCH ?');
      values.push(search);
    }
    const rows = this.archive.database
      .prepare(
        `
        SELECT n.id, n.title, n.type, n.status, n.provenance,
               n.superseded_note_id AS supersedes,
               n.created_at AS createdAt, n.updated_at AS updatedAt,
               (SELECT GROUP_CONCAT(tag) FROM note_tags listed_tags
                WHERE listed_tags.note_id = n.id) AS tags,
               ${search ? 'ROUND(bm25(notes_fts), 6)' : 'NULL'} AS relevance
        FROM notes n
        ${search ? 'JOIN notes_fts ON notes_fts.note_id = n.id' : ''}
        WHERE 1 = 1 ${clauses.map((clause) => `AND ${clause}`).join('\n')}
        ORDER BY ${search ? 'relevance ASC,' : ''} n.updated_at DESC, n.id ASC
        LIMIT ?
      `,
      )
      .all(...values, bounded + 1) as Array<Record<string, unknown>>;
    for (const row of rows)
      row.tags = typeof row.tags === 'string' ? row.tags.split(',').sort() : [];
    return {
      rows: rows.slice(0, bounded),
      limit: bounded,
      truncated: rows.length > bounded,
    };
  }
}
