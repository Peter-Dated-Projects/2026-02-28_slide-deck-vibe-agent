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

import type { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { PgCrdtPersistence } from '../core/crdt/persistence';
import { dbService } from '../core/container';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

interface PresentationDoc {
    projectId: string;
    doc: Y.Doc;
    awareness: awarenessProtocol.Awareness;
    conns: Map<WebSocket, Set<number>>;
    persistence: PgCrdtPersistence;
}

const docs = new Map<string, PresentationDoc>();
const persistence = new PgCrdtPersistence(dbService);

async function getOrLoadDoc(projectId: string): Promise<PresentationDoc> {
    const existing = docs.get(projectId);
    if (existing) return existing;

    const doc = await persistence.loadDoc(projectId);
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);

    const entry: PresentationDoc = {
        projectId,
        doc,
        awareness,
        conns: new Map(),
        persistence,
    };

    // Every local update is (a) appended to the DB log tagged with the
    // origin's agent_id, and (b) broadcast to every other connected client.
    doc.on('update', (update: Uint8Array, origin: unknown) => {
        const agentId = typeof origin === 'string' ? origin : null;
        persistence.appendUpdate(projectId, update, agentId).catch((err) => {
            console.error(`[crdt] failed to persist update for ${projectId}:`, err);
        });
        persistence.maybeSnapshot(projectId).catch((err) => {
            console.error(`[crdt] snapshot check failed for ${projectId}:`, err);
        });
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        const buf = encoding.toUint8Array(encoder);
        entry.conns.forEach((_clientIds, ws) => send(ws, buf));
    });

    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
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
        encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients));
        const buf = encoding.toUint8Array(encoder);
        entry.conns.forEach((_clientIds, ws) => send(ws, buf));
    });

    docs.set(projectId, entry);
    return entry;
}

function send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(data);
    } catch (err) {
        ws.close();
    }
}

function handleMessage(entry: PresentationDoc, ws: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
        case MESSAGE_SYNC: {
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.readSyncMessage(decoder, encoder, entry.doc, ws);
            if (encoding.length(encoder) > 1) {
                send(ws, encoding.toUint8Array(encoder));
            }
            break;
        }
        case MESSAGE_AWARENESS: {
            awarenessProtocol.applyAwarenessUpdate(
                entry.awareness,
                decoding.readVarUint8Array(decoder),
                ws,
            );
            break;
        }
        default:
            console.warn('[crdt] unknown message type', messageType);
    }
}

function closeConn(entry: PresentationDoc, ws: WebSocket): void {
    const clientIds = entry.conns.get(ws);
    if (clientIds) {
        entry.conns.delete(ws);
        awarenessProtocol.removeAwarenessStates(entry.awareness, Array.from(clientIds), null);
    }
    if (entry.conns.size === 0) {
        // Keep the doc in memory briefly; a future optimization can evict after
        // a quiet period. For Phase 1 we drop immediately to keep behavior simple.
        docs.delete(entry.projectId);
    }
    ws.close();
}

async function setupConnection(ws: WebSocket, projectId: string): Promise<void> {
    const entry = await getOrLoadDoc(projectId);
    entry.conns.set(ws, new Set());

    ws.binaryType = 'arraybuffer';
    ws.on('message', (message: ArrayBuffer | Buffer) => {
        const bytes = message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
        try {
            handleMessage(entry, ws, bytes);
        } catch (err) {
            console.error('[crdt] message handler error:', err);
        }
    });
    ws.on('close', () => closeConn(entry, ws));

    // Initial sync: step 1 (send our state vector), plus any current awareness state.
    {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_SYNC);
        syncProtocol.writeSyncStep1(encoder, entry.doc);
        send(ws, encoding.toUint8Array(encoder));
    }
    const awarenessStates = entry.awareness.getStates();
    if (awarenessStates.size > 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(entry.awareness, Array.from(awarenessStates.keys())),
        );
        send(ws, encoding.toUint8Array(encoder));
    }
}

const PATH_REGEX = /^\/ws\/presentation\/([0-9a-fA-F-]{36})$/;

function extractAuth(req: IncomingMessage): { userId: string } | null {
    const url = new URL(req.url ?? '', 'http://localhost');
    const token = url.searchParams.get('token');
    if (!token) return null;
    try {
        const secret = config.auth.jwtSecret || 'secret';
        return jwt.verify(token, secret) as { userId: string };
    } catch {
        return null;
    }
}

export function mountCrdtWebsocket(server: HttpServer): void {
    const wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
        const match = PATH_REGEX.exec(req.url ?? '');
        if (!match) return; // not our route — let another handler take it (or drop)

        const auth = extractAuth(req);
        if (!auth) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        const projectId = match[1]!;
        wss.handleUpgrade(req, socket, head, (ws) => {
            setupConnection(ws, projectId).catch((err) => {
                console.error('[crdt] setup failed:', err);
                ws.close();
            });
        });
    });
}
