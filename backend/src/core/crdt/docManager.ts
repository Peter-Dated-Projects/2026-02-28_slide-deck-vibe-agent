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

import { WebSocket } from 'ws';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { PgCrdtPersistence } from './persistence';
import { dbService } from '../container';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

export interface DocEntry {
    projectId: string;
    doc: Y.Doc;
    awareness: awarenessProtocol.Awareness;
    conns: Map<WebSocket, Set<number>>;
}

class CrdtDocManager {
    private docs = new Map<string, DocEntry>();
    readonly persistence = new PgCrdtPersistence(dbService);

    async getOrLoad(projectId: string): Promise<DocEntry> {
        const existing = this.docs.get(projectId);
        if (existing) return existing;

        const doc = await this.persistence.loadDoc(projectId);
        const awareness = new awarenessProtocol.Awareness(doc);
        awareness.setLocalState(null);

        const entry: DocEntry = { projectId, doc, awareness, conns: new Map() };

        doc.on('update', (update: Uint8Array, origin: unknown) => {
            const agentId = typeof origin === 'string' ? origin : null;
            this.persistence.appendUpdate(projectId, update, agentId).catch((err) => {
                console.error(`[crdt] failed to persist update for ${projectId}:`, err);
            });
            this.persistence.maybeSnapshot(projectId).catch((err) => {
                console.error(`[crdt] snapshot check failed for ${projectId}:`, err);
            });
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.writeUpdate(encoder, update);
            const buf = encoding.toUint8Array(encoder);
            entry.conns.forEach((_clientIds, ws) => send(ws, buf));
        });

        awareness.on(
            'update',
            (
                { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
                origin: unknown
            ) => {
                const changedClients = added.concat(updated, removed);
                if (origin instanceof WebSocket) {
                    const knownClients = entry.conns.get(origin);
                    if (knownClients) {
                        added.forEach((c) => knownClients.add(c));
                        removed.forEach((c) => knownClients.delete(c));
                    }
                }
                const encoder = encoding.createEncoder();
                encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
                encoding.writeVarUint8Array(
                    encoder,
                    awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
                );
                const buf = encoding.toUint8Array(encoder);
                entry.conns.forEach((_clientIds, ws) => send(ws, buf));
            }
        );

        this.docs.set(projectId, entry);
        return entry;
    }

    /** Apply a transactional mutation to the doc, tagged with agentId for "Undo AI". */
    async applyMutation(
        projectId: string,
        fn: (doc: Y.Doc) => void,
        agentId?: string
    ): Promise<void> {
        const entry = await this.getOrLoad(projectId);
        // Wrap so the mutation receives the Y.Doc while transact's callback receives Transaction.
        entry.doc.transact(() => fn(entry.doc), agentId ?? null);
    }

    /** Read-only access to the current in-memory doc state. */
    async readDoc(projectId: string): Promise<Y.Doc> {
        const entry = await this.getOrLoad(projectId);
        return entry.doc;
    }

    removeConn(entry: DocEntry, ws: WebSocket): void {
        const clientIds = entry.conns.get(ws);
        if (clientIds) {
            entry.conns.delete(ws);
            awarenessProtocol.removeAwarenessStates(
                entry.awareness,
                Array.from(clientIds),
                null
            );
        }
        if (entry.conns.size === 0) {
            this.docs.delete(entry.projectId);
        }
        ws.close();
    }
}

export const crdtDocManager = new CrdtDocManager();

function send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(data);
    } catch {
        ws.close();
    }
}
