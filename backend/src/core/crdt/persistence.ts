/**
 * ---------------------------------------------------------------------------
 * (c) 2026 Freedom, LLC.
 * This file is part of the SlideDeckVibeAgent System.
 *
 * All Rights Reserved. This code is the confidential and proprietary
 * information of Freedom, LLC ("Confidential Information"). You shall not
 * disclose such Confidential Information and shall use it only in accordance
 * with the terms of the license agreement you entered into with Freedom, LLC.
 * ---------------------------------------------------------------------------
 */

import * as Y from 'yjs';
import type { IDatabaseService } from '../interfaces/IDatabaseService';
import { createDoc } from './schema';

const SNAPSHOT_UPDATE_THRESHOLD = 128;

export interface CrdtPersistence {
    loadDoc(projectId: string): Promise<Y.Doc>;
    appendUpdate(projectId: string, update: Uint8Array, agentId: string | null): Promise<void>;
    snapshot(projectId: string): Promise<void>;
    maybeSnapshot(projectId: string): Promise<void>;
}

/**
 * Loads a Y.Doc by replaying the latest snapshot + all subsequent incremental
 * updates. Writes flow through appendUpdate (append-only log) and snapshot
 * (full state compaction).
 */
export class PgCrdtPersistence implements CrdtPersistence {
    constructor(private readonly db: IDatabaseService) {}

    async loadDoc(projectId: string): Promise<Y.Doc> {
        const doc = createDoc();

        const snapshotResult = await this.db.query(
            'SELECT doc_state FROM crdt_documents WHERE project_id = $1',
            [projectId]
        );
        if (snapshotResult.rows.length > 0) {
            const raw = snapshotResult.rows[0].doc_state;
            Y.applyUpdate(doc, toUint8Array(raw));
        }

        const updatesResult = await this.db.query(
            'SELECT update FROM crdt_updates WHERE project_id = $1 ORDER BY id ASC',
            [projectId]
        );
        for (const row of updatesResult.rows) {
            Y.applyUpdate(doc, toUint8Array(row.update));
        }

        return doc;
    }

    async appendUpdate(projectId: string, update: Uint8Array, agentId: string | null): Promise<void> {
        await this.db.query(
            'INSERT INTO crdt_updates (project_id, update, agent_id) VALUES ($1, $2, $3)',
            [projectId, Buffer.from(update), agentId]
        );
    }

    async snapshot(projectId: string): Promise<void> {
        const doc = await this.loadDoc(projectId);
        const state = Y.encodeStateAsUpdate(doc);
        const stateBuf = Buffer.from(state);

        const client = await this.db.getClient();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO crdt_documents (project_id, doc_state, snapshot_version, updated_at)
                 VALUES ($1, $2, 1, NOW())
                 ON CONFLICT (project_id)
                 DO UPDATE SET doc_state = EXCLUDED.doc_state,
                               snapshot_version = crdt_documents.snapshot_version + 1,
                               updated_at = NOW()`,
                [projectId, stateBuf]
            );
            await client.query('DELETE FROM crdt_updates WHERE project_id = $1', [projectId]);
            await client.query('COMMIT');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    async maybeSnapshot(projectId: string): Promise<void> {
        const countResult = await this.db.query(
            'SELECT COUNT(*)::int AS n FROM crdt_updates WHERE project_id = $1',
            [projectId]
        );
        if ((countResult.rows[0]?.n ?? 0) >= SNAPSHOT_UPDATE_THRESHOLD) {
            await this.snapshot(projectId);
        }
    }
}

function toUint8Array(raw: Buffer | Uint8Array | string): Uint8Array {
    if (raw instanceof Uint8Array) return raw;
    if (Buffer.isBuffer(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    return new Uint8Array(Buffer.from(raw as string, 'hex'));
}
