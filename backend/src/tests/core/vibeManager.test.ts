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

const { VibeManager } = require('../../core/vibeManager');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const ORIGINAL_TEMPLATE_PATH = path.join(__dirname, '../../core/template.html');
describe('VibeManager', () => {
    let tempDir: string;
    let testTemplatePath: string;
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vibe-manager-test-'));
        testTemplatePath = path.join(tempDir, 'template.test.html');
        await fs.copyFile(ORIGINAL_TEMPLATE_PATH, testTemplatePath);
    });
    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });
    it('extracts the existing theme', async () => {
        const manager = await VibeManager.create(testTemplatePath);
        const theme = manager.getTheme();
        expect(theme).toContain('--vibe-primary: #6366f1;');
        expect(theme).toContain('--vibe-bg: #030712;');
    });
    it('overwrites the theme', async () => {
        const manager = await VibeManager.create(testTemplatePath);
        const newTheme = `
            :root {
                --vibe-primary: #ff4500;
                --vibe-secondary: #ff8c00;
                --vibe-bg: #1a1a1a;
                --vibe-text: #ffffff;
                --vibe-accent: #ffd700;
                --vibe-font: 'Arial', sans-serif;
            }
        `;
        await manager.setTheme(newTheme);
        const freshManager = await VibeManager.create(testTemplatePath);
        const savedTheme = freshManager.getTheme();
        expect(savedTheme).toContain('--vibe-primary: #ff4500;');
        expect(savedTheme).toContain('--vibe-bg: #1a1a1a;');
    });
    it('overwrites an existing slide by id', async () => {
        const manager = await VibeManager.create(testTemplatePath);
        const firstSlide = manager.listSlides()[0];
        if (!firstSlide) throw new Error('Expected at least one slide in template');
        const firstSlideId = firstSlide.id;
        const slideInnerHtml = '<h1>Modified Slide 1</h1>';
        await manager.setSlide(firstSlideId, slideInnerHtml);
        const freshManager = await VibeManager.create(testTemplatePath);
        const savedSlide = freshManager.getSlide(firstSlideId);
        expect(savedSlide).toContain('<section class="slide"');
        expect(savedSlide).toContain('<div class="slide-aspect-ratio-box">');
        expect(savedSlide).toContain('<h1>Modified Slide 1</h1>');
    });
    it('appends a new slide and syncs manifest', async () => {
        const manager = await VibeManager.create(testTemplatePath);
        const newSlideHtml = '<h1>Injected Slide</h1>';
        const newId = await manager.addSlide(newSlideHtml);
        const freshManager = await VibeManager.create(testTemplatePath);
        const savedSlide = freshManager.getSlide(newId);
        expect(savedSlide).toContain('<section class="slide"');
        expect(savedSlide).toContain('<div class="slide-aspect-ratio-box">');
        expect(savedSlide).toContain('<h1>Injected Slide</h1>');
        const manifest = freshManager.getManifest();
        expect(manifest.active_slides).toContain(newId);
    });
    it('deletes a slide by id and syncs manifest', async () => {
        const manager = await VibeManager.create(testTemplatePath);
        const targetSlide = manager.listSlides()[0];
        if (!targetSlide) throw new Error('Expected at least one slide in template');
        const targetId = targetSlide.id;
        await manager.deleteSlide(targetId);
        const freshManager = await VibeManager.create(testTemplatePath);
        expect(freshManager.getSlide(targetId)).toBeNull();
        expect(freshManager.getManifest().active_slides).not.toContain(targetId);
    });
    it('detects template version and validates state', async () => {
        const manager = await VibeManager.create(testTemplatePath);
        expect(manager.detectTemplateVersion()).toBe('v3');
        const validation = manager.validateDeckState();
        expect(validation.isConsistent).toBe(true);
        expect(validation.missingInHtml).toHaveLength(0);
        expect(validation.missingInManifest).toHaveLength(0);
    });
});
