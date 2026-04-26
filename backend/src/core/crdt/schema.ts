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

export const YDOC_ROOT_THEME = 'theme';
export const YDOC_ROOT_SLIDES = 'slides';
export const YDOC_ROOT_ELEMENTS = 'elements';

export type ElementId = string;
export type SlideId = string;

export type ElementType = 'text' | 'image' | 'shape';

export interface ElementShape {
    type: ElementType;
    slide_id: SlideId;
    x: number;
    y: number;
    w: number;
    h: number;
    content: unknown;
    styleOverrides?: Record<string, string>;
}

export interface ThemeShape {
    id: string;
    variables: Record<string, string>;
}

export function createDoc(): Y.Doc {
    const doc = new Y.Doc({ gc: true });
    doc.getMap(YDOC_ROOT_THEME);
    doc.getArray<SlideId>(YDOC_ROOT_SLIDES);
    doc.getMap(YDOC_ROOT_ELEMENTS);
    return doc;
}

export function getTheme(doc: Y.Doc): Y.Map<unknown> {
    return doc.getMap(YDOC_ROOT_THEME);
}

export function getSlides(doc: Y.Doc): Y.Array<SlideId> {
    return doc.getArray<SlideId>(YDOC_ROOT_SLIDES);
}

export function getElements(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
    return doc.getMap<Y.Map<unknown>>(YDOC_ROOT_ELEMENTS);
}

export function readTheme(doc: Y.Doc): ThemeShape {
    const theme = getTheme(doc);
    const variablesMap = theme.get('variables') as Y.Map<string> | undefined;
    return {
        id: (theme.get('id') as string) ?? 'default',
        variables: variablesMap ? Object.fromEntries(variablesMap.entries()) : {},
    };
}

export function readSlideOrder(doc: Y.Doc): SlideId[] {
    return getSlides(doc).toArray();
}

export function readElement(doc: Y.Doc, elementId: ElementId): ElementShape | undefined {
    const el = getElements(doc).get(elementId);
    if (!el) return undefined;
    return {
        type: el.get('type') as ElementType,
        slide_id: el.get('slide_id') as SlideId,
        x: el.get('x') as number,
        y: el.get('y') as number,
        w: el.get('w') as number,
        h: el.get('h') as number,
        content: el.get('content'),
        styleOverrides: el.get('styleOverrides') as Record<string, string> | undefined,
    };
}
