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
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { crdtDocManager, type DocEntry } from '../core/crdt/docManager';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;

function send(ws: WebSocket, data: Uint8Array): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
        ws.send(data);
    } catch {
        ws.close();
    }
}

function handleMessage(entry: DocEntry, ws: WebSocket, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const encoder = encoding.createEncoder();
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
        case MESSAGE_SYNC: {
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.readSyncMessage(decoder, encoder, entry.doc, ws);
            if (encoding.length(encoder) > 1) send(ws, encoding.toUint8Array(encoder));
            break;
        }
        case MESSAGE_AWARENESS: {
            awarenessProtocol.applyAwarenessUpdate(
                entry.awareness,
                decoding.readVarUint8Array(decoder),
                ws
            );
            break;
        }
        default:
            console.warn('[crdt] unknown message type', messageType);
    }
}

async function setupConnection(ws: WebSocket, projectId: string): Promise<void> {
    const entry = await crdtDocManager.getOrLoad(projectId);
    entry.conns.set(ws, new Set());

    ws.binaryType = 'arraybuffer';
    ws.on('message', (message: ArrayBuffer | Buffer) => {
        const bytes =
            message instanceof ArrayBuffer
                ? new Uint8Array(message)
                : new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
        try {
            handleMessage(entry, ws, bytes);
        } catch (err) {
            console.error('[crdt] message handler error:', err);
        }
    });
    ws.on('close', () => crdtDocManager.removeConn(entry, ws));

    // Initial sync: step 1 + current awareness state
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
            awarenessProtocol.encodeAwarenessUpdate(
                entry.awareness,
                Array.from(awarenessStates.keys())
            )
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
        if (!match) return;

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
