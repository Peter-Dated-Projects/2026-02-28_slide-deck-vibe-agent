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

    it('write_slide succeeds with slide_id and matching hash', async () => {
        const readResult = await executeTool(vibeManager, 'read_slide', { slide_id: slide1Id });
        const readParsed = JSON.parse(readResult);
        const hash = readParsed.slides[0].hash;

        const updatedInnerHtml = '<section class="slide"><h1>Updated Title</h1></section>';
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
        expect(currentSlide).toBe(updatedInnerHtml);
    });

    it('write_slide rejects missing slide_id', async () => {
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: '<section class="slide"><h1>Should Not Apply</h1></section>',
            hash: 'unused'
        });

        const parsed = JSON.parse(writeResult);
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
                    newHtml: '<section class="slide"><h1>Batch Updated One</h1></section>',
                    hash: firstHash
                },
                {
                    slide_id: slide2Id,
                    newHtml: '<section class="slide"><h2>Batch Updated Two</h2></section>',
                    hash: 'bad-hash'
                }
            ]
        });

        const parsed = JSON.parse(writeResult);
        expect(parsed.mutated).toBe(true);
        expect(parsed.writes[0].success).toBe(true);
        expect(parsed.writes[1].success).toBe(false);
        expect(parsed.writes[1].error).toContain('Hash mismatch');

        expect(vibeManager.getSlide(slide1Id)).toBe('<section class="slide"><h1>Batch Updated One</h1></section>');
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

        expect(writeSlideTool.function.description).toContain('slide_id only');
        expect(systemInstruction).toContain('slide_id for all write_slide operations');
    });
});
