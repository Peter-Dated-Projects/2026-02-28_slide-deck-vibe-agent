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
import { crdtDocManager } from './docManager';
import { getSlides, getElements } from './schema';
import { computeLayout } from './layout';

const SEED_AGENT_ID = 'system:seed';

export async function seedHelloWorldSlide(projectId: string): Promise<void> {
    const slideId = crypto.randomUUID();
    const elementId = crypto.randomUUID();

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            getSlides(doc).push([slideId]);
            const layout = computeLayout({ slot: 'title' }, doc);
            const el = new Y.Map<unknown>();
            el.set('type', 'text');
            el.set('slide_id', slideId);
            el.set('x', layout.x);
            el.set('y', layout.y);
            el.set('w', layout.w);
            el.set('h', layout.h);
            el.set('content', { html: '<h1 style="text-align:center">Hello, world!</h1>' });
            getElements(doc).set(elementId, el);
        },
        SEED_AGENT_ID,
    );
}
