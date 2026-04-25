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
import { getSlides, getElements, getTheme, readSlideOrder, readTheme, readElement } from './schema';
import { computeLayout, type LayoutSpec } from './layout';
import { loadDesignForProject, saveDesignForProject } from '../../services/projectDeck';
import type { AgentRuntimeState, AgentTaskItem } from '../agentTypes';

// ─── public entry point ───────────────────────────────────────────────────────

export async function executeCrdtTool(
    projectId: string,
    toolName: string,
    args: Record<string, unknown>,
    runtimeState: AgentRuntimeState,
    agentId: string
): Promise<string> {
    try {
        const result = await dispatch(projectId, toolName, args, runtimeState, agentId);
        return JSON.stringify(result);
    } catch (err: any) {
        return JSON.stringify({ success: false, error: err?.message ?? String(err), mutated: false });
    }
}

// ─── dispatcher ───────────────────────────────────────────────────────────────

async function dispatch(
    projectId: string,
    name: string,
    args: Record<string, unknown>,
    state: AgentRuntimeState,
    agentId: string
): Promise<Record<string, unknown>> {
    switch (name) {
        case 'create_tasks':       return createTasks(args, state);
        case 'update_task_status': return updateTaskStatus(args, state);
        case 'design':             return handleDesign(projectId, args);
        case 'read_presentation':  return readPresentation(projectId);
        case 'create_slide':       return createSlide(projectId, args, agentId);
        case 'delete_slide':       return deleteSlide(projectId, args, agentId);
        case 'reorder_slides':     return reorderSlides(projectId, args, agentId);
        case 'duplicate_slide':    return duplicateSlide(projectId, args, agentId);
        case 'add_element':        return addElement(projectId, args, agentId);
        case 'update_element':     return updateElement(projectId, args, agentId);
        case 'delete_element':     return deleteElement(projectId, args, agentId);
        case 'update_theme':       return updateTheme(projectId, args, agentId);
        default:
            return { success: false, error: `Unknown CRDT tool: ${name}`, mutated: false };
    }
}

// ─── task tools (in-memory runtime state, no CRDT) ───────────────────────────

function createTasks(
    args: Record<string, unknown>,
    state: AgentRuntimeState
): Record<string, unknown> {
    if (!Array.isArray(args.tasks)) {
        return { success: false, error: 'Missing tasks array.', mutated: false };
    }
    const existingIds = new Set(state.tasks.map((t) => t.id));
    const seenIds = new Set<string>();
    const created: AgentTaskItem[] = [];

    for (const raw of args.tasks as any[]) {
        if (raw && Object.prototype.hasOwnProperty.call(raw, 'done')) {
            return {
                success: false,
                error: 'create_tasks does not accept done. Use update_task_status.',
                mutated: false,
            };
        }
        const id = String(raw?.id ?? '').trim();
        const description = String(raw?.description ?? '').trim();
        if (!id || !description || existingIds.has(id) || seenIds.has(id)) continue;
        const task: AgentTaskItem = { id, title: description, done: false };
        state.tasks.push(task);
        created.push(task);
        seenIds.add(id);
        existingIds.add(id);
    }
    return { success: true, created, tasks: state.tasks, mutated: false };
}

function updateTaskStatus(
    args: Record<string, unknown>,
    state: AgentRuntimeState
): Record<string, unknown> {
    const id = String(args.id ?? '').trim();
    if (!id || typeof args.done !== 'boolean') {
        return { success: false, error: 'Missing id or done boolean.', mutated: false };
    }
    const idx = state.tasks.findIndex((t) => t.id === id);
    if (idx < 0) {
        return { success: false, error: `Task not found: ${id}`, mutated: false };
    }
    state.tasks[idx] = { ...state.tasks[idx]!, done: args.done };
    return { success: true, task: state.tasks[idx], tasks: state.tasks, mutated: false };
}

// ─── design doc ───────────────────────────────────────────────────────────────

async function handleDesign(
    projectId: string,
    args: Record<string, unknown>
): Promise<Record<string, unknown>> {
    const action = String(args.action ?? '').toLowerCase();

    if (action === 'read') {
        const content = await loadDesignForProject(projectId);
        return { success: true, content, mutated: false };
    }

    if (action === 'write') {
        const section = String(args.section ?? '');
        const validSections = ['intent', 'structure', 'visual_language', 'constraints'];
        if (!validSections.includes(section)) {
            return {
                success: false,
                error: `Invalid section. Must be one of: ${validSections.join(', ')}`,
                mutated: false,
            };
        }
        const content = args.content;
        if (content === undefined) {
            return { success: false, error: 'Missing content.', mutated: false };
        }
        const current = await loadDesignForProject(projectId);
        const updated = replaceSectionInDesign(current, section, String(content));
        await saveDesignForProject(projectId, updated);
        return { success: true, mutated: true, entities_changed: ['design'] };
    }

    return { success: false, error: 'action must be "read" or "write".', mutated: false };
}

function replaceSectionInDesign(md: string, section: string, content: string): string {
    const headers: Record<string, string> = {
        intent: '## Intent',
        structure: '## Structure',
        visual_language: '## Visual language',
        constraints: '## Constraints',
    };
    const header = headers[section]!;
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(${escaped}\\n)[\\s\\S]*?(?=\\n## |$)`);
    if (re.test(md)) {
        return md.replace(re, `$1\n${content}\n`);
    }
    return `${md}\n${header}\n\n${content}\n`;
}

// ─── read presentation ────────────────────────────────────────────────────────

async function readPresentation(projectId: string): Promise<Record<string, unknown>> {
    const doc = await crdtDocManager.readDoc(projectId);
    const slideOrder = readSlideOrder(doc);
    const theme = readTheme(doc);
    const elements: Record<string, unknown> = {};
    getElements(doc).forEach((_el, id) => {
        const shape = readElement(doc, id);
        if (shape) elements[id] = shape;
    });
    return {
        success: true,
        slide_count: slideOrder.length,
        slide_order: slideOrder,
        elements,
        theme,
        mutated: false,
    };
}

// ─── slide management ─────────────────────────────────────────────────────────

async function createSlide(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    const afterSlideId = args.after_slide_id ? String(args.after_slide_id) : undefined;
    const slideId = crypto.randomUUID();

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            const slides = getSlides(doc);
            if (afterSlideId) {
                const arr = slides.toArray();
                const idx = arr.indexOf(afterSlideId);
                slides.insert(idx >= 0 ? idx + 1 : arr.length, [slideId]);
            } else {
                slides.push([slideId]);
            }
        },
        agentId
    );

    return { success: true, slide_id: slideId, mutated: true, entities_changed: ['slides'] };
}

async function deleteSlide(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    const slideId = String(args.slide_id ?? '').trim();
    if (!slideId) return { success: false, error: 'Missing slide_id.', mutated: false };

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            const slides = getSlides(doc);
            const arr = slides.toArray();
            const idx = arr.indexOf(slideId);
            if (idx >= 0) slides.delete(idx, 1);

            const elements = getElements(doc);
            const toDelete: string[] = [];
            elements.forEach((el, id) => {
                if (el.get('slide_id') === slideId) toDelete.push(id);
            });
            for (const id of toDelete) elements.delete(id);
        },
        agentId
    );

    return { success: true, mutated: true, entities_changed: ['slides', 'elements'] };
}

async function reorderSlides(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    if (!Array.isArray(args.slide_ids)) {
        return { success: false, error: 'Missing slide_ids array.', mutated: false };
    }
    const newOrder = (args.slide_ids as unknown[]).map(String);

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            const slides = getSlides(doc);
            slides.delete(0, slides.length);
            slides.push(newOrder);
        },
        agentId
    );

    return { success: true, slide_order: newOrder, mutated: true, entities_changed: ['slides'] };
}

async function duplicateSlide(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    const sourceId = String(args.slide_id ?? '').trim();
    if (!sourceId) return { success: false, error: 'Missing slide_id.', mutated: false };

    const afterSlideId = args.after_slide_id ? String(args.after_slide_id) : sourceId;
    const newSlideId = crypto.randomUUID();
    const newElementIds = new Map<string, string>();

    // Pre-generate element IDs outside the transaction
    const doc = await crdtDocManager.readDoc(projectId);
    getElements(doc).forEach((_el, id) => {
        if (_el.get('slide_id') === sourceId) {
            newElementIds.set(id, crypto.randomUUID());
        }
    });

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            const slides = getSlides(doc);
            const arr = slides.toArray();
            const afterIdx = arr.indexOf(afterSlideId);
            slides.insert(afterIdx >= 0 ? afterIdx + 1 : arr.length, [newSlideId]);

            const elements = getElements(doc);
            newElementIds.forEach((newElId, srcElId) => {
                const src = elements.get(srcElId);
                if (!src) return;
                const copy = new Y.Map<unknown>();
                src.forEach((value, key) => {
                    copy.set(key, key === 'slide_id' ? newSlideId : value);
                });
                elements.set(newElId, copy);
            });
        },
        agentId
    );

    return {
        success: true,
        slide_id: newSlideId,
        mutated: true,
        entities_changed: ['slides', 'elements'],
    };
}

// ─── element management ───────────────────────────────────────────────────────

async function addElement(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    const slideId = String(args.slide_id ?? '').trim();
    const type = String(args.type ?? '').trim();
    if (!slideId) return { success: false, error: 'Missing slide_id.', mutated: false };
    if (!['text', 'image', 'shape'].includes(type)) {
        return { success: false, error: 'type must be text, image, or shape.', mutated: false };
    }
    if (!args.content || typeof args.content !== 'object') {
        return { success: false, error: 'Missing content object.', mutated: false };
    }
    if (!args.layout_spec || typeof args.layout_spec !== 'object') {
        return { success: false, error: 'Missing layout_spec.', mutated: false };
    }

    const elementId = crypto.randomUUID();

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            const layout = computeLayout(args.layout_spec as LayoutSpec, doc);
            const el = new Y.Map<unknown>();
            el.set('type', type);
            el.set('slide_id', slideId);
            el.set('x', layout.x);
            el.set('y', layout.y);
            el.set('w', layout.w);
            el.set('h', layout.h);
            el.set('content', args.content);
            if (args.style_overrides && typeof args.style_overrides === 'object') {
                el.set('styleOverrides', args.style_overrides);
            }
            getElements(doc).set(elementId, el);
        },
        agentId
    );

    return { success: true, element_id: elementId, mutated: true, entities_changed: ['elements'] };
}

async function updateElement(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    const elementId = String(args.element_id ?? '').trim();
    if (!elementId) return { success: false, error: 'Missing element_id.', mutated: false };

    // Check existence before mutation to give a clear error
    const doc = await crdtDocManager.readDoc(projectId);
    if (!getElements(doc).get(elementId)) {
        return { success: false, error: `Element not found: ${elementId}`, mutated: false };
    }

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            const el = getElements(doc).get(elementId);
            if (!el) return; // deleted concurrently — no-op
            if (args.content !== undefined) el.set('content', args.content);
            if (args.style_overrides !== undefined) el.set('styleOverrides', args.style_overrides);
            if (args.layout_spec && typeof args.layout_spec === 'object') {
                const layout = computeLayout(args.layout_spec as LayoutSpec, doc);
                el.set('x', layout.x);
                el.set('y', layout.y);
                el.set('w', layout.w);
                el.set('h', layout.h);
            }
        },
        agentId
    );

    return { success: true, mutated: true, entities_changed: ['elements'] };
}

async function deleteElement(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    const elementId = String(args.element_id ?? '').trim();
    if (!elementId) return { success: false, error: 'Missing element_id.', mutated: false };

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            getElements(doc).delete(elementId);
        },
        agentId
    );

    return { success: true, mutated: true, entities_changed: ['elements'] };
}

// ─── theme ────────────────────────────────────────────────────────────────────

async function updateTheme(
    projectId: string,
    args: Record<string, unknown>,
    agentId: string
): Promise<Record<string, unknown>> {
    if (!args.variables || typeof args.variables !== 'object' || Array.isArray(args.variables)) {
        return { success: false, error: 'Missing variables object.', mutated: false };
    }
    const vars = args.variables as Record<string, string>;

    await crdtDocManager.applyMutation(
        projectId,
        (doc) => {
            const theme = getTheme(doc);
            let variablesMap = theme.get('variables') as Y.Map<string> | undefined;
            if (!variablesMap) {
                variablesMap = new Y.Map<string>();
                theme.set('variables', variablesMap);
            }
            for (const [key, value] of Object.entries(vars)) {
                variablesMap.set(key, String(value));
            }
        },
        agentId
    );

    return { success: true, mutated: true, entities_changed: ['theme'] };
}
