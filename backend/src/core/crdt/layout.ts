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

export const CANVAS_W = 1920;
export const CANVAS_H = 1080;

const MARGIN = 96;
const CONTENT_TOP = 300;
const CONTENT_H = 680;
const HALF_W = (CANVAS_W - MARGIN * 2) / 2; // 864

export interface LayoutSpec {
    slot?: string;
    after?: string;
    position?: { x: number; y: number; w: number; h: number };
}

export interface LayoutResult {
    x: number;
    y: number;
    w: number;
    h: number;
}

const NAMED_SLOTS: Record<string, LayoutResult> = {
    title:       { x: MARGIN,           y: 120,        w: CANVAS_W - MARGIN * 2, h: 220 },
    heading:     { x: MARGIN,           y: 120,        w: CANVAS_W - MARGIN * 2, h: 180 },
    subtitle:    { x: MARGIN,           y: 380,        w: CANVAS_W - MARGIN * 2, h: 120 },
    body:        { x: MARGIN,           y: CONTENT_TOP, w: CANVAS_W - MARGIN * 2, h: CONTENT_H },
    content:     { x: MARGIN,           y: CONTENT_TOP, w: CANVAS_W - MARGIN * 2, h: CONTENT_H },
    left:        { x: MARGIN,           y: CONTENT_TOP, w: HALF_W,                h: CONTENT_H },
    right:       { x: MARGIN + HALF_W + 48, y: CONTENT_TOP, w: HALF_W,           h: CONTENT_H },
    image_left:  { x: MARGIN,           y: 240,        w: 816,                   h: 720 },
    image_right: { x: 1008,             y: 240,        w: 816,                   h: 720 },
    text_left:   { x: MARGIN,           y: 240,        w: 792,                   h: 720 },
    text_right:  { x: 912,              y: 240,        w: 912,                   h: 720 },
    full:        { x: 0,                y: 0,          w: CANVAS_W,              h: CANVAS_H },
    footer:      { x: MARGIN,           y: 960,        w: CANVAS_W - MARGIN * 2, h: 60 },
};

export function computeLayout(spec: LayoutSpec, doc?: Y.Doc): LayoutResult {
    if (spec.position) {
        return { ...spec.position };
    }

    if (spec.slot) {
        const named = NAMED_SLOTS[spec.slot.toLowerCase()];
        if (named) return { ...named };
    }

    if (spec.after && doc) {
        const el = doc.getMap<Y.Map<unknown>>('elements').get(spec.after);
        if (el) {
            const refX = (el.get('x') as number) ?? MARGIN;
            const refW = (el.get('w') as number) ?? CANVAS_W - MARGIN * 2;
            const refY = (el.get('y') as number) ?? 0;
            const refH = (el.get('h') as number) ?? 0;
            return { x: refX, y: refY + refH + 32, w: refW, h: 200 };
        }
    }

    return { ...NAMED_SLOTS.body };
}
