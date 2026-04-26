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

import type { ToolSpec } from '../agentTypes';

export const CRDT_SYSTEM_INSTRUCTION = `\
You are an AI presentation designer with real-time CRDT-based editing capabilities.

The presentation canvas is 1920×1080 pixels. All elements are positioned absolutely.

## Session start
Always call design({action: "read"}) first. If DESIGN.md is empty, fill it in before making any slide changes.

## Workflow
1. Call read_presentation() before structural changes to understand current slide IDs and element IDs.
2. Create slides with create_slide(), then add elements to them with add_element().
3. Edit elements with update_element(); remove them with delete_element().
4. Keep the task checklist current: create_tasks() to plan, update_task_status() as you go.

## Element types and content
- text  → content: { html: "<p>...</p>" }   (HTML rendered inside element)
- image → content: { url: "https://...", alt?: "..." }  (URL only — never base64)
- shape → content: { fill: "#3b82f6", borderRadius?: "8px" }

## Layout slots (1920×1080 canvas, margin=96)
title       full-width top, h=220, y=120
heading     full-width, h=180, y=120
subtitle    full-width, h=120, y=380
body/content full-width main, h=680, y=300
left        left half, w=864, y=300
right       right half, w=864, y=300
image_left  large left image, w=816, h=720, y=240
image_right large right image, w=816, h=720, y=240
text_left   text with image, w=792, y=240
text_right  text with image, w=912, y=240
full        entire canvas (0,0,1920,1080)
footer      bottom bar, h=60, y=960

Use slot names — the server computes exact pixel coordinates.
Use position only for custom pixel-precise placement.
Use after to stack an element below an existing one.

## Design principles
- Keep HTML clean; use style_overrides for per-element CSS tweaks.
- update_theme() applies CSS variables deck-wide.
- Each slide is a blank canvas — there are no implicit backgrounds or containers.
`;

const layoutSpecSchema = {
    type: 'object',
    properties: {
        slot: {
            type: 'string',
            description:
                'Named layout slot: title, heading, subtitle, body, content, left, right, image_left, image_right, text_left, text_right, full, footer.',
        },
        after: {
            type: 'string',
            description: 'Element ID — position this element below the referenced element.',
        },
        position: {
            type: 'object',
            description: 'Explicit pixel coordinates on the 1920×1080 canvas.',
            properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number' },
                h: { type: 'number' },
            },
            required: ['x', 'y', 'w', 'h'],
            additionalProperties: false,
        },
    },
    additionalProperties: false,
};

type OpenAIToolShape = {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
};

function flatten(tools: OpenAIToolShape[]): ToolSpec[] {
    return tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
    }));
}

export function getCrdtTools(): ToolSpec[] {
    return flatten(getCrdtToolsRaw());
}

function getCrdtToolsRaw(): OpenAIToolShape[] {
    return [
        // ── task management ────────────────────────────────────────────────
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
                                    description: { type: 'string' },
                                },
                                required: ['id', 'description'],
                            },
                        },
                    },
                    required: ['tasks'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'update_task_status',
                description: 'Mark a checklist task as done or undone.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        id: { type: 'string' },
                        done: { type: 'boolean' },
                    },
                    required: ['id', 'done'],
                },
            },
        },

        // ── design doc ────────────────────────────────────────────────────
        {
            type: 'function',
            function: {
                name: 'design',
                description:
                    'Read or write DESIGN.md sections (intent, structure, visual_language, constraints). Always read at session start.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        action: { type: 'string', enum: ['read', 'write'] },
                        section: {
                            type: 'string',
                            enum: ['intent', 'structure', 'visual_language', 'constraints'],
                            description: 'Required when action is write.',
                        },
                        content: {
                            type: 'string',
                            description: 'New section content. Required when action is write.',
                        },
                    },
                    required: ['action'],
                },
            },
        },

        // ── read presentation state ────────────────────────────────────────
        {
            type: 'function',
            function: {
                name: 'read_presentation',
                description:
                    'Return the current presentation state: ordered slide IDs, all elements (id, type, slide_id, x, y, w, h, content, styleOverrides), and theme variables.',
                parameters: {
                    type: 'object',
                    properties: {},
                    additionalProperties: false,
                },
            },
        },

        // ── slide management ───────────────────────────────────────────────
        {
            type: 'function',
            function: {
                name: 'create_slide',
                description: 'Add a new blank slide. Returns the new slide_id.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        after_slide_id: {
                            type: 'string',
                            description: 'Insert after this slide ID. Omit to append to the end.',
                        },
                    },
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'delete_slide',
                description: 'Delete a slide and all its elements.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        slide_id: { type: 'string', description: 'ID of the slide to delete.' },
                    },
                    required: ['slide_id'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'reorder_slides',
                description: 'Set the complete slide order. Must list all existing slide IDs.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        slide_ids: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Full ordered array of all slide IDs.',
                        },
                    },
                    required: ['slide_ids'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'duplicate_slide',
                description: 'Duplicate a slide and all its elements. Returns the new slide_id.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        slide_id: { type: 'string', description: 'Source slide to copy.' },
                        after_slide_id: {
                            type: 'string',
                            description:
                                'Insert the new slide after this ID. Defaults to after the source slide.',
                        },
                    },
                    required: ['slide_id'],
                },
            },
        },

        // ── element management ─────────────────────────────────────────────
        {
            type: 'function',
            function: {
                name: 'add_element',
                description: 'Add a new element to a slide. Returns the new element_id.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        slide_id: { type: 'string', description: 'Slide to add the element to.' },
                        type: {
                            type: 'string',
                            enum: ['text', 'image', 'shape'],
                            description: 'Element type.',
                        },
                        content: {
                            type: 'object',
                            description:
                                'Type-specific content. text: {html}, image: {url, alt?}, shape: {fill, borderRadius?}.',
                            additionalProperties: true,
                        },
                        layout_spec: {
                            ...layoutSpecSchema,
                            description:
                                'Position using a named slot, a reference element (after), or explicit pixel coords.',
                        },
                        style_overrides: {
                            type: 'object',
                            description: 'CSS property overrides as key-value pairs.',
                            additionalProperties: { type: 'string' },
                        },
                    },
                    required: ['slide_id', 'type', 'content', 'layout_spec'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'update_element',
                description: 'Update properties of an existing element. Only provided fields are changed.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        element_id: { type: 'string', description: 'ID of the element to update.' },
                        content: {
                            type: 'object',
                            additionalProperties: true,
                            description: 'Replacement content object.',
                        },
                        layout_spec: {
                            ...layoutSpecSchema,
                            description: 'New layout — recomputes x, y, w, h.',
                        },
                        style_overrides: {
                            type: 'object',
                            additionalProperties: { type: 'string' },
                            description: 'Replacement CSS overrides (replaces existing map entirely).',
                        },
                    },
                    required: ['element_id'],
                },
            },
        },
        {
            type: 'function',
            function: {
                name: 'delete_element',
                description: 'Remove an element from the presentation.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        element_id: { type: 'string', description: 'ID of the element to delete.' },
                    },
                    required: ['element_id'],
                },
            },
        },

        // ── theme ──────────────────────────────────────────────────────────
        {
            type: 'function',
            function: {
                name: 'update_theme',
                description:
                    'Merge CSS variable overrides into the deck theme. Unlisted existing variables are preserved.',
                parameters: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        variables: {
                            type: 'object',
                            description: 'CSS variable key-value pairs, e.g. {"--primary": "#3b82f6"}.',
                            additionalProperties: { type: 'string' },
                        },
                    },
                    required: ['variables'],
                },
            },
        },
    ];
}
