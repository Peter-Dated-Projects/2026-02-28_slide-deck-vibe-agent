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

import { randomUUID } from 'crypto';

export interface LayoutNode {
    tag: string;
    id?: string;
    classes?: string[];
    text?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    children: LayoutNode[];
}

export interface LayoutResponse {
    slideId: string;
    viewportWidth: number;
    viewportHeight: number;
    tree: LayoutNode;
}

interface PendingRequest {
    resolve: (data: LayoutResponse) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

/**
 * In-memory store that tracks pending layout analysis requests.
 *
 * Flow:
 * 1. `executeTool` calls `createRequest()` which returns a requestId and a Promise.
 * 2. The SSE stream emits a `layout_request` event to the frontend.
 * 3. The frontend computes the layout and POSTs it to `/api/layout-response`.
 * 4. That endpoint calls `resolveRequest()`, which resolves the Promise from step 1.
 * 5. `executeTool` resumes with the layout data.
 */
class LayoutRequestStore {
    private pending = new Map<string, PendingRequest>();

    /** Default timeout in milliseconds before a pending request is auto-rejected. */
    private static readonly TIMEOUT_MS = 30_000;

    /**
     * Create a new pending layout request.
     * Returns a unique requestId and a Promise that will resolve with the layout data
     * once the frontend responds.
     */
    createRequest(): { requestId: string; promise: Promise<LayoutResponse> } {
        const requestId = randomUUID();

        const promise = new Promise<LayoutResponse>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`Layout request ${requestId} timed out after ${LayoutRequestStore.TIMEOUT_MS}ms. The frontend may not be connected or the slide may not be rendered.`));
            }, LayoutRequestStore.TIMEOUT_MS);

            this.pending.set(requestId, { resolve, reject, timer });
        });

        return { requestId, promise };
    }

    /**
     * Resolve a pending layout request with the data received from the frontend.
     * Returns true if the request was found and resolved, false otherwise.
     */
    resolveRequest(requestId: string, data: LayoutResponse): boolean {
        const pending = this.pending.get(requestId);
        if (!pending) {
            return false;
        }

        clearTimeout(pending.timer);
        this.pending.delete(requestId);
        pending.resolve(data);
        return true;
    }

    /**
     * Check if a request is currently pending.
     */
    hasPending(requestId: string): boolean {
        return this.pending.has(requestId);
    }
}

/** Singleton instance shared across the backend. */
export const layoutRequestStore = new LayoutRequestStore();
