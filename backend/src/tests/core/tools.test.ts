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

    const initialSlideHtml = '<section><h1>Original Title</h1></section>';

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
        ${initialSlideHtml}
        <!-- VIBE_SLIDE_1_END -->
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

    it('read_slide returns JSON with html and sha256 hash', async () => {
        const result = await executeTool(vibeManager, 'read_slide', { index: 1 });
        const parsed = JSON.parse(result);

        const expectedHash = crypto.createHash('sha256').update(initialSlideHtml).digest('hex');

        expect(parsed).toEqual({
            html: initialSlideHtml,
            hash: expectedHash
        });
    });

    it('write_slide succeeds with a correct hash and updates the slide', async () => {
        const readResult = await executeTool(vibeManager, 'read_slide', { index: 1 });
        const { hash } = JSON.parse(readResult);

        const updatedHtml = '<section><h1>Updated Title</h1></section>';
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: updatedHtml,
            hash
        });

        const parsed = JSON.parse(writeResult);
        expect(parsed).toEqual({
            success: true,
            message: 'Successfully updated slide 1'
        });

        const currentSlide = vibeManager.getSlide(1);
        expect(currentSlide).toBe(updatedHtml);
    });

    it('write_slide fails with an incorrect hash and asks to re-read', async () => {
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: '<section><h1>Should Not Apply</h1></section>',
            hash: 'incorrect-hash'
        });

        const parsed = JSON.parse(writeResult);
        expect(parsed.error).toContain('Hash mismatch');
        expect(parsed.error).toContain('Please call read_slide again');

        const currentSlide = vibeManager.getSlide(1);
        expect(currentSlide).toBe(initialSlideHtml);
    });

    it('write_slide fails when hash is missing and asks to read first', async () => {
        const writeResult = await executeTool(vibeManager, 'write_slide', {
            index: 1,
            newHtml: '<section><h1>Should Not Apply</h1></section>'
        });

        const parsed = JSON.parse(writeResult);
        expect(parsed.error).toContain('Missing hash');
        expect(parsed.error).toContain('read the slide first');

        const currentSlide = vibeManager.getSlide(1);
        expect(currentSlide).toBe(initialSlideHtml);
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
        expect(systemInstruction).toContain('MUST first read it using read_slide');
    });
});
