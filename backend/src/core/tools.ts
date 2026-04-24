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

import OpenAI from 'openai';
import { VibeManager } from './vibeManager';
import { layoutRequestStore, type LayoutResponse } from './layoutRequestStore';
import * as crypto from 'crypto';
const HTML_DOCUMENT_LINES_PER_SECTION = 50;
type ToolResult = {
    success?: boolean;
    error?: string;
    mutated?: boolean;
    entities_changed?: string[];
    [key: string]: any;
};
export interface AgentTaskItem {
    id: string;
    title: string;
    done: boolean;
}
export interface AgentRuntimeState {
    tasks: AgentTaskItem[];
}
const hashOf = (value: unknown): string =>
    crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalizeEntities = (entities: string[]): string[] => [...new Set(entities)];
const formatResult = (result: ToolResult): string => {
    return JSON.stringify({
        mutated: Boolean(result.mutated),
        entities_changed: normalizeEntities(result.entities_changed || []),
        ...result
    });
};
const resolveSlideByArgs = (
    vibeManager: VibeManager,
    entry: { slide_id?: string; index?: number }
) => {
    const slides = vibeManager.listSlides();
    if (entry.slide_id) {
        const byId = slides.find((slide) => slide.id === entry.slide_id);
        if (!byId) return null;
        return byId;
    }
    if (entry.index !== undefined) {
        const index = Number(entry.index);
        if (isNaN(index)) return null;
        return slides[index - 1] || null;
    }
    return null;
};
/**
 * Returns the tool definitions along with the current slide count instruction.
 */
export const getTools = async (vibeManager: VibeManager): Promise<{ tools: OpenAI.Chat.ChatCompletionTool[]; systemInstruction: string }> => {
    const slideCount = vibeManager.getSlideCount();
    const tools: OpenAI.Chat.ChatCompletionTool[] = [
        {
            type: 'function',
            function: {
                name: 'create_tasks',
                description: 'Create checklist tasks from id and description. New tasks default to unfinished.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        tasks: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    id: { type: 'string' },
                                    description: { type: 'string' }
                                },
                                required: ['id', 'description']
                            }
                        }
                    },
                    required: ['tasks']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'update_task_status',
                description: 'Mark a checklist task as done/undone.',
                parameters: {
                    type: 'object',
                    properties: {
                        id: { type: 'string' },
                        done: { type: 'boolean' }
                    },
                    required: ['id', 'done']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'list_slides',
                description: 'Return the ordered list of project components (slides) with stable IDs, positions, and per-component hashes.',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'read_slide',
                description: 'Read one or more slides by slide_id (preferred) or 1-based index (fallback). Returns slide_id/index/html/hash tuples.',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_id: { type: 'string', description: 'Stable slide UUID identifier (preferred).' },
                        index: { type: 'number', description: `1-based slide index fallback (1-${slideCount}).` },
                        slide_ids: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Read many slides by stable IDs.'
                        },
                        indices: {
                            type: 'array',
                            items: { type: 'number' },
                            description: `Read many slides by fallback indices (1-${slideCount}).`
                        }
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_slide',
                description: 'Write one or many components (slides) by slide_id only. Requires matching hash from read_slide. Ensure the root HTML element strictly follows the template.html format (e.g. <section class=\"slide\">).',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_id: { type: 'string' },
                        newHtml: { type: 'string' },
                        hash: { type: 'string' },
                        writes: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    slide_id: { type: 'string' },
                                    newHtml: { type: 'string' },
                                    hash: { type: 'string' }
                                },
                                required: ['slide_id', 'newHtml', 'hash']
                            }
                        }
                    },
                    anyOf: [
                        { required: ['slide_id', 'newHtml', 'hash'] },
                        { required: ['writes'] }
                    ]
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'add_slide',
                description: 'Add a new component/slide block. Returns the created slide_id and updates manifest.active_slides. Ensure proper semantic root tags based on template.html (e.g. <section class=\"slide\">).',
                parameters: {
                    type: 'object',
                    properties: {
                        newHtml: { type: 'string' },
                        slide_id: { type: 'string', description: 'Optional explicit slide ID for deterministic replay.' }
                    },
                    required: ['newHtml']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'delete_slide',
                description: 'Delete slide by slide_id (preferred) or index fallback and update manifest.active_slides.',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_id: { type: 'string' },
                        index: { type: 'number' }
                    },
                    anyOf: [{ required: ['slide_id'] }, { required: ['index'] }]
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'duplicate_slide',
                description: 'Duplicate an existing slide by slide_id and append it as a new slide.',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_id: { type: 'string' },
                        new_slide_id: { type: 'string' }
                    },
                    required: ['slide_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'move_slide',
                description: 'Reorder slide manifest by moving one slide ID to a new 1-based position.',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_id: { type: 'string' },
                        target_index: { type: 'number' }
                    },
                    required: ['slide_id', 'target_index']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'manifest',
                description: 'Read or write manifest JSON. Set action to read or write. For write, provide manifest and hash from a prior read.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['read', 'write']
                        },
                        manifest: { type: 'object' },
                        hash: { type: 'string' }
                    },
                    required: ['action']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'reorder_slides',
                description: 'Set manifest.active_slides directly using a full ordered list of slide IDs.',
                parameters: {
                    type: 'object',
                    properties: {
                        active_slides: {
                            type: 'array',
                            items: { type: 'string' }
                        }
                    },
                    required: ['active_slides']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'read_full_html_document',
                description: 'Read the HTML document in 50-line sections. Provide page and sections on every call; returns the requested chunk plus the document line count.',
                parameters: {
                    type: 'object',
                    properties: {
                        page: { type: 'number', description: '1-based section page to start reading from.' },
                        sections: { type: 'number', description: 'Number of 50-line sections to read.' }
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'theme',
                description: 'Read or write deck-wide theme CSS. Set action to read or write. For write, provide css and hash from a prior read.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['read', 'write']
                        },
                        css: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['action']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'transitions',
                description: 'Read or write transitions CSS. Set action to read or write. For write, provide css and hash from a prior read.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['read', 'write']
                        },
                        css: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['action']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'animations',
                description: 'Read or write animations CSS. Set action to read or write. For write, provide css and hash from a prior read.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['read', 'write']
                        },
                        css: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['action']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'global_ui',
                description: 'Read or write global UI HTML. Set action to read or write. For write, provide html and hash from a prior read.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['read', 'write']
                        },
                        html: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['action']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'validate_deck_state',
                description: 'Validate consistency between HTML slide IDs and manifest.active_slides.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'apply_changes',
                description: 'Apply multiple tool operations transactionally. On any error, restore the pre-change snapshot.',
                parameters: {
                    type: 'object',
                    properties: {
                        operations: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    tool: { type: 'string' },
                                    args: { type: 'object' }
                                },
                                required: ['tool']
                            }
                        }
                    },
                    required: ['operations']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'analyze_slide_layout',
                description: 'Renders a slide in the user\'s browser and returns a JSON tree describing every visible element with its tag, classes, text content, and exact pixel position (x, y, width, height) relative to the 1920×1080 slide viewport. Use this to understand where elements are positioned and how large they are before making layout changes.',
                parameters: {
                    type: 'object',
                    properties: {
                        slide_id: { type: 'string', description: 'The slide_id to analyze. Must be a valid slide_id from list_slides.' }
                    },
                    required: ['slide_id']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'design',
                description: 'Read or write DESIGN.md. Set action to read or write. For write, provide section and content.',
                parameters: {
                    type: 'object',
                    properties: {
                        action: {
                            type: 'string',
                            enum: ['read', 'write'],
                            description: 'Whether to read DESIGN.md or write a section.'
                        },
                        section: {
                            type: 'string',
                            enum: ['intent', 'structure', 'visual_language', 'constraints'],
                            description: 'Required when action is write. The section of DESIGN.md to update.'
                        },
                        content: {
                            type: 'string',
                            description: 'Required when action is write. The new content for the section. Use short declarative statements. Do not include the section header - just the content.'
                        }
                    },
                    required: ['action']
                }
            }
        }
    ];
    const systemInstruction = `You are an advanced agent editing a modular web project.

Note: The underlying tools use legacy terminology like "slide" and "deck", but these refer to any modular component or section of the project.

**Core Guidelines:**
1. **Component Management:** Use \`slide_id\` (component ID) for all write operations (index writes are not allowed). Always read before write and pass the returned hash (OCC).
2. **Structure & Formatting:** Every component MUST strictly follow the templated format laid out in our \`template.html\` file. Specifically, each component MUST be wrapped in a \`<section class="slide">\` tag to maintain scroll-snap alignment, and its content must be placed inside a \`<div class="slide-aspect-ratio-box">\` to ensure correct rendering.
3. **Global State:** Use read/write tools for the full HTML document, themes, transitions, animations, and global UI. Use manifest tools or reorder_slides/move_slide to control active slide order.
4. **Updates:** Keep progress updates brief. When a tool finishes, briefly explain what you did and your current status. After structural edits, call validate_deck_state.

When you need to call a tool, you must ONLY use the native tool call format: <execute_tool>function_name{json_arguments}</execute_tool>. Do not use other XML tags, bracketed text like [Tool Call], or any other tool-call syntax.

At the start of every new session, call \`design({\"action\":\"read\"})\` before responding to the user. Use the contents to orient yourself - do not ask the user to re-explain decisions that are already documented. If DESIGN.md is empty, ask the user for the presentation's core intent and structure, then call \`design({\"action\":\"write\",\"section\":...,\"content\":...})\` to record it before proceeding.

On every turn, check whether your response involves a design-level decision. If it does, call \`design({\"action\":\"read\"})\` first to verify consistency, and call \`design({\"action\":\"write\",\"section\":...,\"content\":...})\` after if something durable was decided.`;
    return { tools, systemInstruction };
};
/**
 * Executes a tool call and returns the result string.
 */
export type OnLayoutRequest = (requestId: string, slideId: string) => void;

export const executeTool = async (
    vibeManager: VibeManager,
    name: string,
    args: any,
    runtimeState?: AgentRuntimeState,
    onLayoutRequest?: OnLayoutRequest
): Promise<string> => {
    try {
        if (name === 'create_tasks') {
            if (!runtimeState) {
                return formatResult({ error: 'Task list runtime is unavailable.', mutated: false });
            }
            if (!Array.isArray(args?.tasks)) {
                return formatResult({ error: 'Missing tasks array.', mutated: false });
            }
            const existingIds = new Set(runtimeState.tasks.map((task) => task.id));
            const createdTasks: AgentTaskItem[] = [];
            const seenIncomingIds = new Set<string>();
            for (const rawTask of args.tasks) {
                if (rawTask && Object.prototype.hasOwnProperty.call(rawTask, 'done')) {
                    return formatResult({
                        error: 'create_tasks does not accept task completion status. Use update_task_status.',
                        mutated: false
                    });
                }
                const id = String(rawTask?.id || '').trim();
                const description = String(rawTask?.description || '').trim();
                if (!id || !description || existingIds.has(id) || seenIncomingIds.has(id)) {
                    continue;
                }
                const nextTask: AgentTaskItem = {
                    id,
                    title: description,
                    done: false
                };
                runtimeState.tasks.push(nextTask);
                createdTasks.push(nextTask);
                seenIncomingIds.add(id);
            }
            return formatResult({ success: true, created: createdTasks, tasks: runtimeState.tasks, mutated: false });
        }
        if (name === 'update_task_status') {
            if (!runtimeState) {
                return formatResult({ error: 'Task list runtime is unavailable.', mutated: false });
            }
            const id = String(args?.id || '').trim();
            if (!id || typeof args?.done !== 'boolean') {
                return formatResult({ error: 'Missing id or done boolean.', mutated: false });
            }
            const idx = runtimeState.tasks.findIndex((task) => task.id === id);
            if (idx < 0) {
                return formatResult({ error: `Task not found: ${id}`, mutated: false });
            }
            runtimeState.tasks[idx] = {
                ...runtimeState.tasks[idx]!,
                done: args.done
            };
            return formatResult({ success: true, task: runtimeState.tasks[idx], tasks: runtimeState.tasks, mutated: false });
        }
        if (name === 'list_slides') {
            const slides = vibeManager.listSlides().map((slide) => ({
                slide_id: slide.id,
                index: slide.index,
                hash: hashOf(slide.content),
                legacy: slide.legacy
            }));
            return formatResult({ success: true, slides, slide_count: slides.length, mutated: false });
        }
        if (name === 'read_slide') {
            const requests: Array<{ slide_id?: string; index?: number }> = [];
            if (args?.slide_id) requests.push({ slide_id: String(args.slide_id) });
            if (args?.index !== undefined) requests.push({ index: Number(args.index) });
            if (Array.isArray(args?.slide_ids)) {
                for (const slideId of args.slide_ids) {
                    requests.push({ slide_id: String(slideId) });
                }
            }
            if (Array.isArray(args?.indices)) {
                for (const index of args.indices) {
                    requests.push({ index: Number(index) });
                }
            }
            if (requests.length === 0) {
                return formatResult({ error: 'Missing slide_id/index/slide_ids/indices.', mutated: false });
            }
            const response = requests.map((entry) => {
                const slide = resolveSlideByArgs(vibeManager, entry);
                if (!slide) {
                    return {
                        slide_id: entry.slide_id || null,
                        index: entry.index || null,
                        error: 'Slide not found'
                    };
                }
                return {
                    slide_id: slide.id,
                    index: slide.index,
                    html: slide.content,
                    hash: hashOf(slide.content)
                };
            });
            return formatResult({ success: true, slides: response, mutated: false });
        }
        if (name === 'write_slide') {
            const writesInput = Array.isArray(args?.writes)
                ? args.writes
                : [{ slide_id: args?.slide_id, newHtml: args?.newHtml, hash: args?.hash }];
            if (!Array.isArray(writesInput) || writesInput.length === 0) {
                return formatResult({ error: 'Missing writes payload.', mutated: false });
            }
            const writes: Array<{ slide_id?: string; index?: number; success: boolean; error?: string; message?: string }> = [];
            for (const write of writesInput) {
                if (!write?.slide_id) {
                    writes.push({
                        success: false,
                        error: 'slide_id is required for write_slide.'
                    });
                    continue;
                }
                const slide = resolveSlideByArgs(vibeManager, write || {});
                if (!slide) {
                    writes.push({
                        slide_id: write?.slide_id,
                        success: false,
                        error: 'Slide not found. Provide a valid slide_id.'
                    });
                    continue;
                }
                if (!write?.newHtml) {
                    writes.push({ slide_id: slide.id, index: slide.index, success: false, error: 'Missing newHtml.' });
                    continue;
                }
                if (!write?.hash) {
                    writes.push({ slide_id: slide.id, index: slide.index, success: false, error: 'Missing hash. Read slide before writing.' });
                    continue;
                }
                const current = vibeManager.getSlide(slide.id);
                const currentHash = hashOf(current || '');
                if (currentHash !== write.hash) {
                    writes.push({
                        slide_id: slide.id,
                        index: slide.index,
                        success: false,
                        error: 'Hash mismatch. Slide changed since last read.'
                    });
                    continue;
                }
                await vibeManager.setSlide(slide.id, write.newHtml);
                writes.push({ slide_id: slide.id, index: slide.index, success: true, message: `Updated slide ${slide.id}` });
            }
            const anySuccess = writes.some((w) => w.success);
            const failedWrites = writes.filter((w) => !w.success);
            const hasFailures = failedWrites.length > 0;
            return formatResult({
                success: !hasFailures,
                error: hasFailures
                    ? `write_slide failed for ${failedWrites.length} of ${writes.length} write(s).`
                    : undefined,
                writes,
                mutated: anySuccess,
                entities_changed: anySuccess ? ['slides'] : []
            });
        }
        if (name === 'add_slide') {
            if (!args?.newHtml) {
                return formatResult({ error: 'Missing newHtml.', mutated: false });
            }
            const slideId = await vibeManager.addSlide(args.newHtml, args.slide_id);
            return formatResult({ success: true, slide_id: slideId, mutated: true, entities_changed: ['slides', 'manifest'] });
        }
        if (name === 'delete_slide') {
            const identifier = args?.slide_id || args?.index;
            if (!identifier) return formatResult({ error: 'Missing slide_id or index.', mutated: false });
            await vibeManager.deleteSlide(identifier);
            return formatResult({ success: true, mutated: true, entities_changed: ['slides', 'manifest'] });
        }
        if (name === 'duplicate_slide') {
            if (!args?.slide_id) return formatResult({ error: 'Missing slide_id.', mutated: false });
            const created = await vibeManager.duplicateSlide(args.slide_id, args.new_slide_id);
            return formatResult({ success: true, slide_id: created, mutated: true, entities_changed: ['slides', 'manifest'] });
        }
        if (name === 'move_slide') {
            const slideId = args?.slide_id;
            const targetIndex = Number(args?.target_index);
            if (!slideId || isNaN(targetIndex) || targetIndex < 1) {
                return formatResult({ error: 'Missing or invalid slide_id/target_index.', mutated: false });
            }
            const manifest = vibeManager.getManifest();
            const existingIndex = manifest.active_slides.indexOf(slideId);
            if (existingIndex < 0) {
                return formatResult({ error: `slide_id ${slideId} not found in manifest.active_slides.`, mutated: false });
            }
            const reordered = [...manifest.active_slides];
            reordered.splice(existingIndex, 1);
            const boundedIndex = Math.min(targetIndex - 1, reordered.length);
            reordered.splice(boundedIndex, 0, slideId);
            await vibeManager.reorderManifestSlides(reordered);
            return formatResult({ success: true, active_slides: reordered, mutated: true, entities_changed: ['manifest'] });
        }
        if (name === 'manifest') {
            const action = String(args?.action || '').trim().toLowerCase();
            if (!action || !['read', 'write'].includes(action)) {
                return formatResult({ error: 'Invalid or missing action. Must be one of: read, write', mutated: false });
            }
            if (action === 'read') {
                const manifest = vibeManager.getManifest();
                return formatResult({ success: true, manifest, hash: hashOf(manifest), mutated: false });
            }
            if (!args?.manifest) return formatResult({ error: 'Missing manifest payload.', mutated: false });
            if (!args?.hash) return formatResult({ error: 'Missing hash. Read manifest first.', mutated: false });
            const current = vibeManager.getManifest();
            const currentHash = hashOf(current);
            if (currentHash !== args.hash) {
                return formatResult({ error: 'Hash mismatch. Manifest changed since last read.', mutated: false });
            }
            await vibeManager.setManifest(args.manifest);
            return formatResult({ success: true, mutated: true, entities_changed: ['manifest'] });
        }
        if (name === 'read_full_html_document') {
            const page = Number(args?.page || 1);
            const sections = Number(args?.sections || 1);
            if (isNaN(page) || isNaN(sections) || page < 1 || sections < 1) {
                return formatResult({ error: 'Missing or invalid page/sections. Both must be positive numbers.', mutated: false });
            }
            const documentSection = vibeManager.getDocumentSection(page, sections, HTML_DOCUMENT_LINES_PER_SECTION);
            return formatResult({
                success: true,
                html: documentSection.html,
                hash: hashOf(documentSection.html),
                page,
                sections,
                lines_per_section: HTML_DOCUMENT_LINES_PER_SECTION,
                start_line: documentSection.startLine + 1,
                end_line: documentSection.endLine,
                max_length: documentSection.maxLength,
                mutated: false
            });
        }
        if (name === 'reorder_slides') {
            if (!Array.isArray(args?.active_slides)) {
                return formatResult({ error: 'Missing active_slides array.', mutated: false });
            }
            const htmlSlideIds = vibeManager.listSlides().map((s) => s.id);
            const missing = args.active_slides.filter((id: string) => !htmlSlideIds.includes(id));
            if (missing.length > 0) {
                return formatResult({ error: `active_slides contains IDs absent from HTML: ${missing.join(', ')}`, mutated: false });
            }
            await vibeManager.reorderManifestSlides(args.active_slides);
            return formatResult({ success: true, mutated: true, entities_changed: ['manifest'] });
        }
        if (name === 'theme') {
            const action = String(args?.action || '').trim().toLowerCase();
            if (!action || !['read', 'write'].includes(action)) {
                return formatResult({ error: 'Invalid or missing action. Must be one of: read, write', mutated: false });
            }
            if (action === 'read') {
                const css = vibeManager.getTheme();
                if (!css) return formatResult({ error: 'No theme block found.', mutated: false });
                return formatResult({ success: true, css, hash: hashOf(css), mutated: false });
            }
            if (!args?.css) return formatResult({ error: 'Missing css.', mutated: false });
            if (!args?.hash) return formatResult({ error: 'Missing hash. Read theme first.', mutated: false });
            const current = vibeManager.getTheme();
            if (!current) return formatResult({ error: 'No theme block found.', mutated: false });
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch. Theme changed since read.', mutated: false });
            await vibeManager.setTheme(args.css);
            return formatResult({ success: true, mutated: true, entities_changed: ['theme'] });
        }
        if (name === 'transitions') {
            const action = String(args?.action || '').trim().toLowerCase();
            if (!action || !['read', 'write'].includes(action)) {
                return formatResult({ error: 'Invalid or missing action. Must be one of: read, write', mutated: false });
            }
            if (action === 'read') {
                const css = vibeManager.getTransitions();
                if (!css) return formatResult({ error: 'No transitions block found.', mutated: false });
                return formatResult({ success: true, css, hash: hashOf(css), mutated: false });
            }
            if (!args?.css || !args?.hash) return formatResult({ error: 'Missing css/hash.', mutated: false });
            const current = vibeManager.getTransitions();
            if (!current) return formatResult({ error: 'No transitions block found.', mutated: false });
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch for transitions.', mutated: false });
            await vibeManager.setTransitions(args.css);
            return formatResult({ success: true, mutated: true, entities_changed: ['transitions'] });
        }
        if (name === 'animations') {
            const action = String(args?.action || '').trim().toLowerCase();
            if (!action || !['read', 'write'].includes(action)) {
                return formatResult({ error: 'Invalid or missing action. Must be one of: read, write', mutated: false });
            }
            if (action === 'read') {
                const css = vibeManager.getAnimations();
                if (!css) return formatResult({ error: 'No animations block found.', mutated: false });
                return formatResult({ success: true, css, hash: hashOf(css), mutated: false });
            }
            if (!args?.css || !args?.hash) return formatResult({ error: 'Missing css/hash.', mutated: false });
            const current = vibeManager.getAnimations();
            if (!current) return formatResult({ error: 'No animations block found.', mutated: false });
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch for animations.', mutated: false });
            await vibeManager.setAnimations(args.css);
            return formatResult({ success: true, mutated: true, entities_changed: ['animations'] });
        }
        if (name === 'global_ui') {
            const action = String(args?.action || '').trim().toLowerCase();
            if (!action || !['read', 'write'].includes(action)) {
                return formatResult({ error: 'Invalid or missing action. Must be one of: read, write', mutated: false });
            }
            if (action === 'read') {
                const html = vibeManager.getGlobalUI();
                return formatResult({ success: true, html, hash: hashOf(html), mutated: false });
            }
            if (args?.html === undefined || !args?.hash) return formatResult({ error: 'Missing html/hash.', mutated: false });
            const current = vibeManager.getGlobalUI();
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch for global UI.', mutated: false });
            await vibeManager.setGlobalUI(args.html);
            return formatResult({ success: true, mutated: true, entities_changed: ['global_ui'] });
        }
        if (name === 'analyze_slide_layout') {
            const slideId = String(args?.slide_id || '').trim();
            if (!slideId) {
                return formatResult({ error: 'Missing slide_id.', mutated: false });
            }
            const slide = resolveSlideByArgs(vibeManager, { slide_id: slideId });
            if (!slide) {
                return formatResult({ error: `Slide not found: ${slideId}`, mutated: false });
            }
            if (!onLayoutRequest) {
                return formatResult({ error: 'Layout analysis is not available in this context (no active browser session).', mutated: false });
            }
            const { requestId, promise } = layoutRequestStore.createRequest();
            onLayoutRequest(requestId, slideId);
            try {
                const layoutData: LayoutResponse = await promise;
                return formatResult({
                    success: true,
                    slide_id: slideId,
                    viewport: { width: layoutData.viewportWidth, height: layoutData.viewportHeight },
                    layout_tree: layoutData.tree,
                    mutated: false
                });
            } catch (err: any) {
                return formatResult({ error: `Layout analysis failed: ${err.message}`, mutated: false });
            }
        }
        if (name === 'design') {
            const action = String(args?.action || '').trim().toLowerCase();
            if (!action || !['read', 'write'].includes(action)) {
                return formatResult({ error: 'Invalid or missing action. Must be one of: read, write', mutated: false });
            }
            if (action === 'read') {
                const content = await vibeManager.readDesign();
                return formatResult({ success: true, content, hash: hashOf(content), mutated: false });
            }
            const section = args?.section;
            const content = args?.content;
            if (!section || !['intent', 'structure', 'visual_language', 'constraints'].includes(section)) {
                return formatResult({ error: 'Invalid or missing section. Must be one of: intent, structure, visual_language, constraints', mutated: false });
            }
            if (content === undefined) {
                return formatResult({ error: 'Missing content.', mutated: false });
            }
            await vibeManager.writeDesign(section, content);
            return formatResult({ success: true, mutated: true, entities_changed: ['design'] });
        }
        if (name === 'validate_deck_state') {
            const validation = vibeManager.validateDeckState();
            return formatResult({ success: true, validation, mutated: false });
        }
        if (name === 'apply_changes') {
            const operations = Array.isArray(args?.operations) ? args.operations : [];
            if (operations.length === 0) {
                return formatResult({ error: 'Missing operations array.', mutated: false });
            }
            const nonTransactionalTools = new Set(['apply_changes']);
            const snapshot = vibeManager.getContentSnapshot();
            const results: Array<{ tool: string; result: any }> = [];
            const changed: string[] = [];
            let mutated = false;
            for (const operation of operations) {
                const toolName = String(operation?.tool || '');
                if (!toolName || nonTransactionalTools.has(toolName)) {
                    await vibeManager.restoreContentSnapshot(snapshot);
                    return formatResult({
                        error: `Invalid operation tool: ${toolName || 'unknown'}`,
                        rolled_back: true,
                        results,
                        mutated: false
                    });
                }
                const raw = await executeTool(vibeManager, toolName, operation?.args || {}, runtimeState, onLayoutRequest);
                let parsed: any;
                try {
                    parsed = JSON.parse(raw);
                } catch {
                    parsed = { success: false, error: 'Failed to parse nested tool result.' };
                }
                results.push({ tool: toolName, result: parsed });
                if (parsed?.error) {
                    await vibeManager.restoreContentSnapshot(snapshot);
                    return formatResult({
                        error: `Operation failed: ${toolName}: ${parsed.error}`,
                        rolled_back: true,
                        results,
                        mutated: false
                    });
                }
                if (parsed?.mutated) {
                    mutated = true;
                }
                if (Array.isArray(parsed?.entities_changed)) {
                    changed.push(...parsed.entities_changed);
                }
            }
            return formatResult({
                success: true,
                results,
                mutated,
                entities_changed: changed,
                rolled_back: false
            });
        }
        return formatResult({ error: `Unknown tool: ${name}`, mutated: false });
    } catch (e: any) {
        return formatResult({ error: e.message, mutated: false });
    }
};
