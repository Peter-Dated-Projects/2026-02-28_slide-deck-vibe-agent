import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { VibeManager } from '../../core/vibeManager';
import { executeTool, getTools } from '../../core/tools';

describe('Core Tools - read/write slide OCC', () => {
    let tempDir: string;
    let tempFilePath: string;
    let vibeManager: VibeManager;

    const initialSlideInnerHtml = '<h1>Original Title</h1>';
    const secondSlideInnerHtml = '<h2>Second Slide</h2><p>Details</p>';

    const fixtureHtml = `<!doctype html>
<html>
<head>
    <style>
        <!-- VIBE_THEME_START -->
        :root { --vibe-primary: #111111; }
        <!-- VIBE_THEME_END -->
    </style>
</head>
<body>
    <div>
        <!-- VIBE_SLIDES_CONTAINER_START -->
        <!-- VIBE_SLIDE_1_START -->
        <section class="slide">${initialSlideInnerHtml}</section>
        <!-- VIBE_SLIDE_1_END -->
        <!-- VIBE_SLIDE_2_START -->
        <section class="slide">${secondSlideInnerHtml}</section>
        <!-- VIBE_SLIDE_2_END -->
        <!-- VIBE_SLIDES_CONTAINER_END -->
    </div>
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

    it('read_slide returns slideId/html/hash mapping for a single slide', async () => {
        const result = await executeTool(vibeManager, 'read_slide', { index: 1 });
        const parsed = JSON.parse(result);

        const expectedHash = crypto.createHash('sha256').update(initialSlideInnerHtml).digest('hex');

        expect(parsed).toEqual({
            slides: [
                {
                    slideId: 1,
                    html: initialSlideInnerHtml,
                    hash: expectedHash
                }
            ]
        });
    });

    it('read_slide supports multiple slide indices and returns unique per-slide hashes', async () => {
        const result = await executeTool(vibeManager, 'read_slide', { indices: [1, 2] });
        const parsed = JSON.parse(result);

        const firstHash = crypto.createHash('sha256').update(initialSlideInnerHtml).digest('hex');
        const secondHash = crypto.createHash('sha256').update(secondSlideInnerHtml).digest('hex');

        expect(parsed).toEqual({
            slides: [
                {
                    slideId: 1,
                    html: initialSlideInnerHtml,
                    hash: firstHash
                },
                {
                    slideId: 2,
                    html: secondSlideInnerHtml,
                    hash: secondHash
                }
            ]
        });
        expect(parsed.slides[0].hash).not.toBe(parsed.slides[1].hash);
    });

    it('write_slide succeeds with a correct hash and updates the slide', async () => {
        const readResult = await executeTool(vibeManager, 'read_slide', { index: 1 });
        const hash = JSON.parse(readResult).slides[0].hash;

        const updatedInnerHtml = '<h1>Updated Title</h1>';
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: updatedInnerHtml,
            hash
        });

        const parsed = JSON.parse(writeResult);
        expect(parsed).toEqual({
            success: true,
            message: 'Successfully updated slide 1'
        });

        const currentSlide = vibeManager.getSlide(1);
        expect(currentSlide).toBe(updatedInnerHtml);
    });

    it('write_slide fails with an incorrect hash and asks to re-read', async () => {
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: '<h1>Should Not Apply</h1>',
            hash: 'incorrect-hash'
        });

        const parsed = JSON.parse(writeResult);
        expect(parsed.error).toContain('Hash mismatch');
        expect(parsed.error).toContain('Please call read_slide again');

        const currentSlide = vibeManager.getSlide(1);
        expect(currentSlide).toBe(initialSlideInnerHtml);
    });

    it('write_slide fails when hash is missing and asks to read first', async () => {
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: '<h1>Should Not Apply</h1>'
        });

        const parsed = JSON.parse(writeResult);
        expect(parsed.error).toContain('Missing hash');
        expect(parsed.error).toContain('read the slide first');

        const currentSlide = vibeManager.getSlide(1);
        expect(currentSlide).toBe(initialSlideInnerHtml);
    });

    it('getTools advertises write_slide hash requirements', async () => {
        const { tools, systemInstruction } = await getTools(vibeManager);

        const writeSlideTool = tools.find(
            (tool): tool is Extract<(typeof tools)[number], { type: 'function' }> =>
                tool.type === 'function' && tool.function.name === 'write_slide'
        );
        expect(writeSlideTool).toBeDefined();
        if (!writeSlideTool) {
            throw new Error('write_slide tool is not registered');
        }

        const params = writeSlideTool.function.parameters as { required?: string[] } | undefined;
        if (!params?.required) {
            throw new Error('write_slide tool parameters are missing required fields');
        }

        const requiredParams = params.required;
        expect(requiredParams).toEqual(['index', 'newHtml', 'hash']);
        expect(writeSlideTool.function.description).toContain('MUST provide the content hash');
        expect(writeSlideTool.function.description).toContain('inside <section class=\"slide\">');
        expect(systemInstruction).toContain('MUST first read it using read_slide');
        expect(systemInstruction).toContain('returns explicit slideId/html/hash tuples');
        expect(systemInstruction).toContain('only return/modify the content inside each <section class="slide">');
        expect(systemInstruction).toContain('shared across the entire slide deck');
    });
});
