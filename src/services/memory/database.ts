import { open } from '@op-engineering/op-sqlite';
import type { DB } from '@op-engineering/op-sqlite';
import logger from '../../utils/logger';
import type {
  CreateMemoryInput,
  MemoryItem,
  MemoryScope,
  MemoryStatus,
  StoredMemoryEmbedding,
} from './types';

type DbMemoryRow = Omit<MemoryItem, 'tags'> & { tags_json?: string | null };

function parseTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
}

function toMemoryItem(row: DbMemoryRow): MemoryItem {
  const { tags_json, ...rest } = row;
  return {
    ...rest,
    tags: parseTags(tags_json),
  };
}

class MemoryDatabase {
  private db: DB | null = null;
  private ready = false;

  async ensureReady(): Promise<void> {
    if (this.ready) return;
    try {
      this.db = open({ name: 'memory.db' });
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS memory_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL,
          project_id TEXT,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          body TEXT NOT NULL,
          tags_json TEXT NOT NULL DEFAULT '[]',
          confidence REAL NOT NULL DEFAULT 0.8,
          importance INTEGER NOT NULL DEFAULT 3,
          status TEXT NOT NULL DEFAULT 'active',
          source_type TEXT NOT NULL DEFAULT 'manual',
          source_id TEXT,
          source_excerpt TEXT,
          jurisdiction TEXT,
          as_of_date TEXT,
          valid_from TEXT,
          valid_until TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_used_at TEXT
        )`
      );
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS memory_embeddings (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER NOT NULL,
          embedding BLOB NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_items(id)
        )`
      );
      this.db.executeSync(
        `CREATE TABLE IF NOT EXISTS memory_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_id INTEGER,
          action TEXT NOT NULL,
          details_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL
        )`
      );
      this.db.executeSync('CREATE INDEX IF NOT EXISTS idx_memory_scope_project_status ON memory_items(scope, project_id, status)');
      this.db.executeSync('CREATE INDEX IF NOT EXISTS idx_memory_embeddings_memory_id ON memory_embeddings(memory_id)');
      this.ready = true;
    } catch (error) {
      logger.error('[MemoryDB] Failed to initialize:', error);
      throw error;
    }
  }

  private getDb(): DB {
    if (!this.db) throw new Error('MemoryDatabase not initialized. Call ensureReady() first.');
    return this.db;
  }

  createMemory(input: CreateMemoryInput): number {
    const db = this.getDb();
    const now = new Date().toISOString();
    const scope: MemoryScope = input.scope ?? (input.projectId ? 'project' : 'global');
    const result = db.executeSync(
      `INSERT INTO memory_items (
        scope, project_id, kind, title, body, tags_json, confidence, importance, status,
        source_type, source_id, source_excerpt, jurisdiction, as_of_date, valid_from,
        valid_until, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        scope,
        scope === 'project' ? input.projectId ?? null : null,
        input.kind ?? 'research_note',
        input.title,
        input.body,
        JSON.stringify(input.tags ?? []),
        input.confidence ?? 0.8,
        input.importance ?? 3,
        'active',
        input.sourceType ?? 'manual',
        input.sourceId ?? null,
        input.sourceExcerpt ?? null,
        input.jurisdiction ?? null,
        input.asOfDate ?? null,
        input.validFrom ?? null,
        input.validUntil ?? null,
        now,
        now,
      ]
    );
    if (result.insertId == null) throw new Error('Failed to insert memory: no insertId returned');
    return result.insertId;
  }

  getMemory(id: number): MemoryItem | null {
    const db = this.getDb();
    const result = db.executeSync('SELECT * FROM memory_items WHERE id = ?', [id]);
    const rows = (result.rows ?? []) as unknown as DbMemoryRow[];
    return rows.length > 0 ? toMemoryItem(rows[0]) : null;
  }

  getActiveMemories(projectId?: string): MemoryItem[] {
    const db = this.getDb();
    const result = projectId
      ? db.executeSync(
        `SELECT * FROM memory_items
         WHERE status = 'active' AND (scope = 'global' OR (scope = 'project' AND project_id = ?))
         ORDER BY importance DESC, updated_at DESC`,
        [projectId]
      )
      : db.executeSync(
        `SELECT * FROM memory_items
         WHERE status = 'active' AND scope = 'global'
         ORDER BY importance DESC, updated_at DESC`
      );
    return ((result.rows ?? []) as unknown as DbMemoryRow[]).map(toMemoryItem);
  }

  getEmbeddingsForRecall(projectId?: string): StoredMemoryEmbedding[] {
    const db = this.getDb();
    const result = projectId
      ? db.executeSync(
        `SELECT e.embedding, m.*
         FROM memory_embeddings e
         JOIN memory_items m ON e.memory_id = m.id
         WHERE m.status = 'active' AND (m.scope = 'global' OR (m.scope = 'project' AND m.project_id = ?))`,
        [projectId]
      )
      : db.executeSync(
        `SELECT e.embedding, m.*
         FROM memory_embeddings e
         JOIN memory_items m ON e.memory_id = m.id
         WHERE m.status = 'active' AND m.scope = 'global'`
      );
    return ((result.rows ?? []) as unknown as Array<DbMemoryRow & { embedding: any }>).map(row => ({
      ...toMemoryItem(row),
      embedding: this.blobToEmbedding(row.embedding),
    }));
  }

  setEmbedding(memoryId: number, embedding: number[]): void {
    const db = this.getDb();
    db.executeSync('DELETE FROM memory_embeddings WHERE memory_id = ?', [memoryId]);
    db.executeSync('INSERT INTO memory_embeddings (memory_id, embedding) VALUES (?, ?)', [
      memoryId,
      this.embeddingToBlob(embedding),
    ]);
  }

  markUsed(memoryIds: number[]): void {
    if (memoryIds.length === 0) return;
    const db = this.getDb();
    const now = new Date().toISOString();
    for (const id of memoryIds) {
      db.executeSync('UPDATE memory_items SET last_used_at = ? WHERE id = ?', [now, id]);
    }
  }

  setStatus(memoryId: number, status: MemoryStatus): boolean {
    const db = this.getDb();
    const result = db.executeSync(
      'UPDATE memory_items SET status = ?, updated_at = ? WHERE id = ?',
      [status, new Date().toISOString(), memoryId]
    );
    return (result.rowsAffected ?? 0) > 0;
  }

  addEvent(memoryId: number | null, action: string, details: Record<string, unknown> = {}): void {
    const db = this.getDb();
    db.executeSync(
      'INSERT INTO memory_events (memory_id, action, details_json, created_at) VALUES (?, ?, ?, ?)',
      [memoryId, action, JSON.stringify(details), new Date().toISOString()]
    );
  }

  deleteProjectMemories(projectId: string): void {
    const db = this.getDb();
    db.executeSync(
      'DELETE FROM memory_embeddings WHERE memory_id IN (SELECT id FROM memory_items WHERE project_id = ?)',
      [projectId]
    );
    db.executeSync('DELETE FROM memory_items WHERE project_id = ?', [projectId]);
  }

  private embeddingToBlob(embedding: number[]): ArrayBuffer {
    return new Float32Array(embedding).buffer;
  }

  private blobToEmbedding(blob: any): number[] {
    if (blob instanceof ArrayBuffer) return Array.from(new Float32Array(blob));
    if (blob?.buffer instanceof ArrayBuffer) return Array.from(new Float32Array(blob.buffer));
    return [];
  }
}

export const memoryDatabase = new MemoryDatabase();
