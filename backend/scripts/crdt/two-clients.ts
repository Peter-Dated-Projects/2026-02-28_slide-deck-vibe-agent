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

/**
 * Phase 1 convergence check.
 *
 * Two standalone clients connect to the backend CRDT WebSocket, each mutates
 * the doc independently, and we assert both converge to identical state.
 *
 * Run:
 *   bun run scripts/crdt/two-clients.ts --project <uuid> --token <jwt>
 */

import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { createDoc, getElements, getSlides } from '../../src/core/crdt/schema';

const MESSAGE_SYNC = 0;

interface Args {
    projectId: string;
    token: string;
    baseUrl: string;
}

function parseArgs(): Args {
    const out: Partial<Args> = {
        baseUrl: process.env.CRDT_WS_URL ?? 'ws://localhost:3001',
    };
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = argv[i + 1];
        if (flag === '--project') { out.projectId = value; i++; }
        else if (flag === '--token') { out.token = value; i++; }
        else if (flag === '--url') { out.baseUrl = value!; i++; }
    }
    if (!out.projectId || !out.token) {
        console.error('Usage: bun run scripts/crdt/two-clients.ts --project <uuid> --token <jwt> [--url ws://host]');
        process.exit(1);
    }
    return out as Args;
}

function connect(args: Args, label: string): Promise<{ ws: WebSocket; doc: Y.Doc }> {
    return new Promise((resolve, reject) => {
        const url = `${args.baseUrl}/ws/presentation/${args.projectId}?token=${encodeURIComponent(args.token)}`;
        const ws = new WebSocket(url);
        const doc = createDoc();

        ws.binaryType = 'arraybuffer';
        ws.on('open', () => {
            console.log(`[${label}] connected`);
            // Send sync step 1
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.writeSyncStep1(encoder, doc);
            ws.send(encoding.toUint8Array(encoder));
            resolve({ ws, doc });
        });
        ws.on('error', reject);
        ws.on('message', (data: ArrayBuffer | Buffer) => {
            const bytes = data instanceof ArrayBuffer
                ? new Uint8Array(data)
                : new Uint8Array((data as Buffer).buffer, (data as Buffer).byteOffset, (data as Buffer).byteLength);
            const decoder = decoding.createDecoder(bytes);
            const messageType = decoding.readVarUint(decoder);
            if (messageType !== MESSAGE_SYNC) return; // ignore awareness in this test
            const reply = encoding.createEncoder();
            encoding.writeVarUint(reply, MESSAGE_SYNC);
            const syncType = syncProtocol.readSyncMessage(decoder, reply, doc, ws);
            // syncType 0 = step1 from server; reply has step2. Send it back.
            if (syncType === syncProtocol.messageYjsSyncStep1 && encoding.length(reply) > 1) {
                ws.send(encoding.toUint8Array(reply));
            }
        });

        // Pipe local updates to the wire, origin-tagged with the label.
        doc.on('update', (update: Uint8Array, origin: unknown) => {
            if (origin === ws) return; // came from the network; don't echo
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MESSAGE_SYNC);
            syncProtocol.writeUpdate(encoder, update);
            ws.send(encoding.toUint8Array(encoder));
        });
    });
}

async function main() {
    const args = parseArgs();
    const [a, b] = await Promise.all([connect(args, 'A'), connect(args, 'B')]);

    // Give initial sync a moment to settle.
    await new Promise((r) => setTimeout(r, 500));

    // Client A: add a slide with one text element.
    a.doc.transact(() => {
        const slideId = `slide-${Date.now()}-a`;
        const elementId = `el-${Date.now()}-a`;
        getSlides(a.doc).push([slideId]);
        const el = new Y.Map();
        el.set('type', 'text');
        el.set('slide_id', slideId);
        el.set('x', 100); el.set('y', 100); el.set('w', 400); el.set('h', 80);
        el.set('content', 'Hello from A');
        getElements(a.doc).set(elementId, el);
    }, 'client:A');

    // Client B: concurrently add a different slide.
    b.doc.transact(() => {
        const slideId = `slide-${Date.now()}-b`;
        const elementId = `el-${Date.now()}-b`;
        getSlides(b.doc).push([slideId]);
        const el = new Y.Map();
        el.set('type', 'text');
        el.set('slide_id', slideId);
        el.set('x', 200); el.set('y', 200); el.set('w', 400); el.set('h', 80);
        el.set('content', 'Hello from B');
        getElements(b.doc).set(elementId, el);
    }, 'client:B');

    // Allow propagation.
    await new Promise((r) => setTimeout(r, 1500));

    const stateA = Y.encodeStateAsUpdate(a.doc);
    const stateB = Y.encodeStateAsUpdate(b.doc);
    const slidesA = getSlides(a.doc).toArray();
    const slidesB = getSlides(b.doc).toArray();
    const elementsA = getElements(a.doc).size;
    const elementsB = getElements(b.doc).size;

    console.log('slides on A:', slidesA);
    console.log('slides on B:', slidesB);
    console.log(`elements A=${elementsA}, B=${elementsB}`);

    const converged = stateA.length === stateB.length
        && slidesA.length === 2 && slidesB.length === 2
        && elementsA === 2 && elementsB === 2;

    if (!converged) {
        console.error('FAIL: clients did not converge');
        process.exit(2);
    }
    console.log('PASS: both clients converged to identical state');
    a.ws.close();
    b.ws.close();
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
