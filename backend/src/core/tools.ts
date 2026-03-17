import OpenAI from 'openai';
import { VibeManager } from './vibeManager';
import * as crypto from 'crypto';

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
                description: 'Return the ordered slide list with stable slide IDs, positions, and per-slide hashes.',
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
                description: 'Write one or many slides by slide_id only. Requires matching hash from read_slide.',
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
                description: 'Add a new slide block. Returns the created slide_id and updates manifest.active_slides.',
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
                name: 'read_manifest',
                description: 'Read the current vibe manifest JSON and return its content hash.',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_manifest',
                description: 'Write manifest JSON with OCC hash validation from read_manifest.',
                parameters: {
                    type: 'object',
                    properties: {
                        manifest: { type: 'object' },
                        hash: { type: 'string' }
                    },
                    required: ['manifest', 'hash']
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
                name: 'read_theme',
                description: 'Read deck-wide theme CSS and return hash.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_theme',
                description: 'Write deck-wide theme CSS with OCC hash validation.',
                parameters: {
                    type: 'object',
                    properties: {
                        newCss: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['newCss', 'hash']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'read_transitions',
                description: 'Read transitions CSS and return hash.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_transitions',
                description: 'Write transitions CSS with OCC hash validation.',
                parameters: {
                    type: 'object',
                    properties: {
                        css: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['css', 'hash']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'read_animations',
                description: 'Read animations CSS and return hash.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_animations',
                description: 'Write animations CSS with OCC hash validation.',
                parameters: {
                    type: 'object',
                    properties: {
                        css: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['css', 'hash']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'read_global_ui',
                description: 'Read global UI HTML and return hash.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'write_global_ui',
                description: 'Write global UI HTML with OCC hash validation.',
                parameters: {
                    type: 'object',
                    properties: {
                        html: { type: 'string' },
                        hash: { type: 'string' }
                    },
                    required: ['html', 'hash']
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
                name: 'detect_template_version',
                description: 'Detect whether current deck appears to be V2 or V3.',
                parameters: { type: 'object', properties: {} }
            }
        },
        {
            type: 'function',
            function: {
                name: 'migrate_template_to_v3',
                description: 'Migrate a legacy V2 template to V3 UUID markers and initialize manifest/global UI markers.',
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
        }
    ];

    const systemInstruction = `You are editing a Vibe V3 slide deck with stable UUID slide IDs. Use slide_id for all write_slide operations (index writes are not allowed). Index may still be used for read_slide when needed. Always read before write and pass the returned hash (OCC). Use list_slides first when planning multi-slide updates. Use read_manifest/write_manifest or reorder_slides/move_slide to control active slide order. Use write_theme, write_transitions, write_animations, and write_global_ui for global style/UI updates. After structural edits, call validate_deck_state to confirm HTML and manifest alignment. Keep progress updates brief: when a tool finishes, briefly explain what you did and your current status.`;

    return { tools, systemInstruction };
};

/**
 * Executes a tool call and returns the result string.
 */
export const executeTool = async (
    vibeManager: VibeManager,
    name: string,
    args: any,
    runtimeState?: AgentRuntimeState
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
            return formatResult({ success: true, writes, mutated: anySuccess, entities_changed: anySuccess ? ['slides'] : [] });
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

        if (name === 'read_manifest') {
            const manifest = vibeManager.getManifest();
            return formatResult({ success: true, manifest, hash: hashOf(manifest), mutated: false });
        }

        if (name === 'write_manifest') {
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

        if (name === 'read_theme') {
            const css = vibeManager.getTheme();
            if (!css) return formatResult({ error: 'No theme block found.', mutated: false });
            return formatResult({ success: true, css, hash: hashOf(css), mutated: false });
        }

        if (name === 'write_theme') {
            if (!args?.newCss) return formatResult({ error: 'Missing newCss.', mutated: false });
            if (!args?.hash) return formatResult({ error: 'Missing hash. Read theme first.', mutated: false });

            const current = vibeManager.getTheme();
            if (!current) return formatResult({ error: 'No theme block found.', mutated: false });
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch. Theme changed since read.', mutated: false });

            await vibeManager.setTheme(args.newCss);
            return formatResult({ success: true, mutated: true, entities_changed: ['theme'] });
        }

        if (name === 'read_transitions') {
            const css = vibeManager.getTransitions();
            if (!css) return formatResult({ error: 'No transitions block found.', mutated: false });
            return formatResult({ success: true, css, hash: hashOf(css), mutated: false });
        }

        if (name === 'write_transitions') {
            if (!args?.css || !args?.hash) return formatResult({ error: 'Missing css/hash.', mutated: false });
            const current = vibeManager.getTransitions();
            if (!current) return formatResult({ error: 'No transitions block found.', mutated: false });
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch for transitions.', mutated: false });
            await vibeManager.setTransitions(args.css);
            return formatResult({ success: true, mutated: true, entities_changed: ['transitions'] });
        }

        if (name === 'read_animations') {
            const css = vibeManager.getAnimations();
            if (!css) return formatResult({ error: 'No animations block found.', mutated: false });
            return formatResult({ success: true, css, hash: hashOf(css), mutated: false });
        }

        if (name === 'write_animations') {
            if (!args?.css || !args?.hash) return formatResult({ error: 'Missing css/hash.', mutated: false });
            const current = vibeManager.getAnimations();
            if (!current) return formatResult({ error: 'No animations block found.', mutated: false });
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch for animations.', mutated: false });
            await vibeManager.setAnimations(args.css);
            return formatResult({ success: true, mutated: true, entities_changed: ['animations'] });
        }

        if (name === 'read_global_ui') {
            const html = vibeManager.getGlobalUI();
            return formatResult({ success: true, html, hash: hashOf(html), mutated: false });
        }

        if (name === 'write_global_ui') {
            if (args?.html === undefined || !args?.hash) return formatResult({ error: 'Missing html/hash.', mutated: false });
            const current = vibeManager.getGlobalUI();
            if (hashOf(current) !== args.hash) return formatResult({ error: 'Hash mismatch for global UI.', mutated: false });
            await vibeManager.setGlobalUI(args.html);
            return formatResult({ success: true, mutated: true, entities_changed: ['global_ui'] });
        }

        if (name === 'validate_deck_state') {
            const validation = vibeManager.validateDeckState();
            return formatResult({ success: true, validation, mutated: false });
        }

        if (name === 'detect_template_version') {
            const version = vibeManager.detectTemplateVersion();
            return formatResult({ success: true, version, mutated: false });
        }

        if (name === 'migrate_template_to_v3') {
            const migration = await vibeManager.migrateToV3();
            return formatResult({
                success: true,
                migration,
                mutated: migration.migrated,
                entities_changed: migration.migrated ? ['slides', 'manifest', 'global_ui'] : []
            });
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

                const raw = await executeTool(vibeManager, toolName, operation?.args || {}, runtimeState);
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
