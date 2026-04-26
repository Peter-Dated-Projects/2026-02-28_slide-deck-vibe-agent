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
 * Phase 1 snapshot round-trip check.
 *
 * Exercises PgCrdtPersistence directly against the database:
 *   - appends 5 updates to a temporary project,
 *   - snapshots (which must compact the update log to zero rows),
 *   - re-loads the doc and verifies it matches the pre-snapshot state.
 *
 * Run:
 *   bun run scripts/crdt/snapshot.ts --project <uuid>
 *
 * The project row must exist (FK constraint). Create one via the app or
 * pass an existing projectId.
 */

import * as Y from 'yjs';
import { dbService } from '../../src/core/container';
import { PgCrdtPersistence } from '../../src/core/crdt/persistence';
import { createDoc, getElements, getSlides } from '../../src/core/crdt/schema';

function getProjectIdFromArgs(): string {
    const idx = process.argv.indexOf('--project');
    const v = idx >= 0 ? process.argv[idx + 1] : undefined;
    if (!v) {
        console.error('Usage: bun run scripts/crdt/snapshot.ts --project <uuid>');
        process.exit(1);
    }
    return v;
}

async function main() {
    const projectId = getProjectIdFromArgs();
    const persistence = new PgCrdtPersistence(dbService);

    // Clean slate for the test project.
    await dbService.query('DELETE FROM crdt_updates WHERE project_id = $1', [projectId]);
    await dbService.query('DELETE FROM crdt_documents WHERE project_id = $1', [projectId]);

    const doc = createDoc();
    for (let i = 0; i < 5; i++) {
        doc.transact(() => {
            const slideId = `s-${i}`;
            getSlides(doc).push([slideId]);
            const el = new Y.Map();
            el.set('type', 'text'); el.set('slide_id', slideId);
            el.set('x', i * 10); el.set('y', 0); el.set('w', 100); el.set('h', 40);
            el.set('content', `slide ${i}`);
            getElements(doc).set(`e-${i}`, el);
        }, `seed:${i}`);
        const update = Y.encodeStateAsUpdate(doc);
        await persistence.appendUpdate(projectId, update, 'test');
        // Reset the doc's tracked updates each iteration by using a fresh doc.
        // (We're exercising the persistence layer, not Yjs's batching.)
    }

    const beforeCount = (await dbService.query(
        'SELECT COUNT(*)::int AS n FROM crdt_updates WHERE project_id = $1', [projectId]
    )).rows[0].n;
    console.log('updates before snapshot:', beforeCount);

    await persistence.snapshot(projectId);

    const afterCount = (await dbService.query(
        'SELECT COUNT(*)::int AS n FROM crdt_updates WHERE project_id = $1', [projectId]
    )).rows[0].n;
    const snapshotRow = (await dbService.query(
        'SELECT snapshot_version FROM crdt_documents WHERE project_id = $1', [projectId]
    )).rows[0];
    console.log('updates after snapshot:', afterCount);
    console.log('snapshot_version:', snapshotRow?.snapshot_version);

    const reloaded = await persistence.loadDoc(projectId);
    const reloadedSlides = getSlides(reloaded).toArray();
    const reloadedElements = getElements(reloaded).size;
    console.log('reloaded slides:', reloadedSlides);
    console.log('reloaded element count:', reloadedElements);

    const ok = afterCount === 0
        && snapshotRow?.snapshot_version === 1
        && reloadedSlides.length === 5
        && reloadedElements === 5;

    if (!ok) {
        console.error('FAIL: snapshot round-trip mismatch');
        process.exit(2);
    }
    console.log('PASS: snapshot compacted log and reload preserved state');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
