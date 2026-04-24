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

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { VibeManager } = require('../../core/vibeManager');
const { executeTool, getTools } = require('../../core/tools');
const hashOf = (value: unknown): string =>
    crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
describe('Core Tools - V3 UUID and OCC behavior', () => {
    let tempDir: string;
    let tempFilePath: string;
    let vibeManager: any;
    const slide1Id = '11111111-1111-4111-8111-111111111111';
    const slide2Id = '22222222-2222-4222-8222-222222222222';
    const initialSlideInnerHtml = '<section class="slide"><h1>Original Title</h1></section>';
    const secondSlideInnerHtml = '<section class="slide"><h2>Second Slide</h2><p>Details</p></section>';
    const fixtureHtml = `<!doctype html>
<html>
<head>
    <style>
        <!-- VIBE_THEME_START -->
        :root { --vibe-primary: #111111; }
        <!-- VIBE_THEME_END -->
        <!-- VIBE_TRANSITIONS_START -->
        .slide { transition: opacity 0.3s ease; }
        <!-- VIBE_TRANSITIONS_END -->
        <!-- VIBE_ANIMATIONS_START -->
        @keyframes pulse { from { opacity: 0.6; } to { opacity: 1; } }
        <!-- VIBE_ANIMATIONS_END -->
    </style>
</head>
<body>
    <!-- <!-- VIBE_GLOBAL_UI_START --> -->
    <nav></nav>
    <!-- <!-- VIBE_GLOBAL_UI_END --> -->
    <div id="vibe-deck">
        <!-- <!-- VIBE_SLIDES_CONTAINER_START --> -->
        <!-- VIBE_SLIDE_ID:${slide1Id}_START -->
        ${initialSlideInnerHtml}
        <!-- VIBE_SLIDE_ID:${slide1Id}_END -->
        <!-- VIBE_SLIDE_ID:${slide2Id}_START -->
        ${secondSlideInnerHtml}
        <!-- VIBE_SLIDE_ID:${slide2Id}_END -->
        <!-- <!-- VIBE_SLIDES_CONTAINER_END --> -->
    </div>
    <!-- <!-- VIBE_MANIFEST_START --> -->
    <script id="vibe-manifest" type="application/json">
    {
        "engine_version": "3.0.0",
        "project_id": "test-project",
        "theme_id": "default",
        "transition_style": "fade",
        "active_slides": ["${slide1Id}", "${slide2Id}"]
    }
    </script>
    <!-- <!-- VIBE_MANIFEST_END --> -->
</body>
</html>`;
    const longFixtureHtml = `<!doctype html>
<html>
<head>
    <title>Long Doc</title>
</head>
<body>
${Array.from({ length: 120 }, (_value, index) => `LINE ${index + 1}`).join('\n')}
</body>
</html>`;
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-tools-'));
        tempFilePath = path.join(tempDir, 'deck.html');
        await fs.writeFile(tempFilePath, fixtureHtml, { encoding: 'utf-8' });
        vibeManager = await VibeManager.create(tempFilePath);
    });
    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });
    it('read_slide returns slide_id/index/html/hash entries', async () => {
        const result = await executeTool(vibeManager, 'read_slide', { slide_id: slide1Id });
        const parsed = JSON.parse(result);
        expect(parsed.success).toBe(true);
        expect(parsed.mutated).toBe(false);
        expect(parsed.slides).toHaveLength(1);
        expect(parsed.slides[0]).toEqual({
            slide_id: slide1Id,
            index: 1,
            html: initialSlideInnerHtml,
            hash: hashOf(initialSlideInnerHtml)
        });
    });
    it('read_full_html_document returns the full HTML document and hash', async () => {
        const result = await executeTool(vibeManager, 'read_full_html_document', {});
        const parsed = JSON.parse(result);
        expect(parsed.success).toBe(true);
        expect(parsed.mutated).toBe(false);
        expect(parsed.html).toBe(fixtureHtml);
        expect(parsed.hash).toBe(hashOf(fixtureHtml));
        expect(parsed.max_length).toBe(fixtureHtml.split(/\r?\n/).length);
    });
    it('read_full_html_document paginates 50-line sections with max_length metadata', async () => {
        await fs.writeFile(tempFilePath, longFixtureHtml, { encoding: 'utf-8' });
        vibeManager = await VibeManager.create(tempFilePath);

        const firstPageResult = await executeTool(vibeManager, 'read_full_html_document', { page: 1, sections: 1 });
        const firstPageParsed = JSON.parse(firstPageResult);
        const longLines = longFixtureHtml.split(/\r?\n/);
        expect(firstPageParsed.success).toBe(true);
        expect(firstPageParsed.page).toBe(1);
        expect(firstPageParsed.sections).toBe(1);
        expect(firstPageParsed.lines_per_section).toBe(50);
        expect(firstPageParsed.start_line).toBe(1);
        expect(firstPageParsed.end_line).toBe(50);
        expect(firstPageParsed.max_length).toBe(longLines.length);
        expect(firstPageParsed.html).toBe(longLines.slice(0, 50).join('\n'));

        const secondPageResult = await executeTool(vibeManager, 'read_full_html_document', { page: 2, sections: 2 });
        const secondPageParsed = JSON.parse(secondPageResult);
        expect(secondPageParsed.success).toBe(true);
        expect(secondPageParsed.page).toBe(2);
        expect(secondPageParsed.sections).toBe(2);
        expect(secondPageParsed.start_line).toBe(51);
        expect(secondPageParsed.end_line).toBe(longLines.length);
        expect(secondPageParsed.html).toBe(longLines.slice(50).join('\n'));
    });
    it('write_slide succeeds with slide_id and matching hash', async () => {
        const readResult = await executeTool(vibeManager, 'read_slide', { slide_id: slide1Id });
        const readParsed = JSON.parse(readResult);
        const hash = readParsed.slides[0].hash;
        const updatedInnerHtml = '<h1>Updated Title</h1>';
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            slide_id: slide1Id,
            newHtml: updatedInnerHtml,
            hash
        });
        const parsed = JSON.parse(writeResult);
        expect(parsed.mutated).toBe(true);
        expect(parsed.writes).toEqual([
            {
                slide_id: slide1Id,
                index: 1,
                success: true,
                message: `Updated slide ${slide1Id}`
            }
        ]);
        const currentSlide = vibeManager.getSlide(slide1Id);
        expect(currentSlide).toContain('<section class="slide"');
        expect(currentSlide).toContain('<div class="slide-aspect-ratio-box">');
        expect(currentSlide).toContain('<h1>Updated Title</h1>');
    });
    it('write_slide rejects missing slide_id', async () => {
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: '<h1>Should Not Apply</h1>',
            hash: 'unused'
        });
        const parsed = JSON.parse(writeResult);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain('write_slide failed');
        expect(parsed.mutated).toBe(false);
        expect(parsed.writes[0].error).toContain('slide_id is required');
    });
    it('write_slide supports batch writes with per-entry results', async () => {
        const readResult = await executeTool(vibeManager, 'read_slide', { slide_ids: [slide1Id, slide2Id] });
        const parsedRead = JSON.parse(readResult);
        const firstHash = parsedRead.slides[0].hash;
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            writes: [
                {
                    slide_id: slide1Id,
                    newHtml: '<h1>Batch Updated One</h1>',
                    hash: firstHash
                },
                {
                    slide_id: slide2Id,
                    newHtml: '<h2>Batch Updated Two</h2>',
                    hash: 'bad-hash'
                }
            ]
        });
        const parsed = JSON.parse(writeResult);
        expect(parsed.success).toBe(false);
        expect(parsed.error).toContain('write_slide failed');
        expect(parsed.mutated).toBe(true);
        expect(parsed.writes[0].success).toBe(true);
        expect(parsed.writes[1].success).toBe(false);
        expect(parsed.writes[1].error).toContain('Hash mismatch');
        expect(vibeManager.getSlide(slide1Id)).toContain('<section class="slide"');
        expect(vibeManager.getSlide(slide1Id)).toContain('<div class="slide-aspect-ratio-box">');
        expect(vibeManager.getSlide(slide1Id)).toContain('<h1>Batch Updated One</h1>');
        expect(vibeManager.getSlide(slide2Id)).toBe(secondSlideInnerHtml);
    });
    it('getTools advertises slide_id requirement for write_slide', async () => {
        const { tools, systemInstruction } = await getTools(vibeManager);
        const writeSlideTool = tools.find((tool: any) => tool.type === 'function' && tool.function.name === 'write_slide');
        expect(writeSlideTool).toBeDefined();
        if (!writeSlideTool) throw new Error('write_slide tool is not registered');
        const params = writeSlideTool.function.parameters as { anyOf?: Array<{ required?: string[] }> } | undefined;
        expect(params?.anyOf).toEqual([
            { required: ['slide_id', 'newHtml', 'hash'] },
            { required: ['writes'] }
        ]);
        expect(writeSlideTool.function.description).toContain('tool injects it into the existing <section class="slide"> and <div class="slide-aspect-ratio-box"> wrappers');
        expect(systemInstruction).toContain('Use `slide_id` (component ID) for all write operations');
        expect(systemInstruction).toContain('For `add_slide` and `write_slide`, provide only the inner HTML for the `slide-aspect-ratio-box`');
    });
    it('getTools includes read_full_html_document for full document access', async () => {
        const { tools } = await getTools(vibeManager);
        const readHtmlDocumentTool = tools.find((tool: any) => tool.type === 'function' && tool.function.name === 'read_full_html_document');
        expect(readHtmlDocumentTool).toBeDefined();
        if (!readHtmlDocumentTool) throw new Error('read_full_html_document tool is not registered');
        expect(readHtmlDocumentTool.function.description).toContain('entire HTML document');
        expect((readHtmlDocumentTool.function.parameters as any)?.properties?.page?.type).toBe('number');
        expect((readHtmlDocumentTool.function.parameters as any)?.properties?.sections?.type).toBe('number');
    });
    it('update_task_status updates an existing in-memory checklist task', async () => {
        const runtimeState = {
            tasks: [
                { id: 'task-1', title: 'Inspect slides', done: false },
                { id: 'task-2', title: 'Apply updates', done: false }
            ]
        };
        const updateResult = await executeTool(vibeManager, 'update_task_status', {
            id: 'task-1',
            done: true
        }, runtimeState);
        const updateParsed = JSON.parse(updateResult);
        expect(updateParsed.success).toBe(true);
        expect(updateParsed.task).toEqual({
            id: 'task-1',
            title: 'Inspect slides',
            done: true
        });
        expect(runtimeState.tasks.some((task: any) => task.id === 'task-1' && task.done)).toBe(true);
        expect(runtimeState.tasks.some((task: any) => task.id === 'task-2' && !task.done)).toBe(true);
    });
    it('create_tasks creates tasks with done=false and uses description as title', async () => {
        const runtimeState = {
            tasks: [
                { id: 'existing-task', title: 'Already exists', done: true }
            ]
        };
        const createResult = await executeTool(vibeManager, 'create_tasks', {
            tasks: [
                { id: 'task-1', description: 'Inspect slides' },
                { id: 'task-2', description: 'Apply updates' },
                { id: 'existing-task', description: 'Should be ignored' }
            ]
        }, runtimeState);
        const createParsed = JSON.parse(createResult);
        expect(createParsed.success).toBe(true);
        expect(createParsed.created).toEqual([
            { id: 'task-1', title: 'Inspect slides', done: false },
            { id: 'task-2', title: 'Apply updates', done: false }
        ]);
        expect(createParsed.tasks.some((task: any) => task.id === 'task-1' && !task.done)).toBe(true);
        expect(createParsed.tasks.some((task: any) => task.id === 'task-2' && !task.done)).toBe(true);
        expect(createParsed.tasks.filter((task: any) => task.id === 'existing-task')).toHaveLength(1);
    });
    it('create_tasks rejects tasks that include completion status', async () => {
        const runtimeState = {
            tasks: []
        };
        const createResult = await executeTool(vibeManager, 'create_tasks', {
            tasks: [
                { id: 'task-1', description: 'Inspect slides', done: true }
            ]
        }, runtimeState);
        const createParsed = JSON.parse(createResult);
        expect(createParsed.mutated).toBe(false);
        expect(createParsed.error).toContain('does not accept task completion status');
        expect(runtimeState.tasks).toHaveLength(0);
    });
    it('getTools includes create_tasks with id and description fields', async () => {
        const { tools } = await getTools(vibeManager);
        const createTasksTool = tools.find((tool: any) => tool.type === 'function' && tool.function.name === 'create_tasks');
        expect(createTasksTool).toBeDefined();
        if (!createTasksTool) throw new Error('create_tasks tool is not registered');
        const taskItemSchema = (createTasksTool.function.parameters as any)?.properties?.tasks?.items;
        expect((createTasksTool.function.parameters as any)?.additionalProperties).toBe(false);
        expect(taskItemSchema?.required).toEqual(['id', 'description']);
        expect(taskItemSchema?.properties?.id?.type).toBe('string');
        expect(taskItemSchema?.properties?.description?.type).toBe('string');
        expect(taskItemSchema?.additionalProperties).toBe(false);
    });
});
