import * as fs from 'fs/promises';
import * as path from 'path';

export interface VibeManifest {
    engine_version: string;
    project_id: string;
    theme_id: string;
    transition_style: string;
    active_slides: string[];
    [key: string]: any;
}

export class VibeManager {
    /**
     * Surgical Orchestrator for Vibe Slide V3 HTML files.
     * Uses optimized regex to manage themes, transitions, and ID-based slides.
     */
    private filePath: string;
    private content: string;

    private constructor(filePath: string, content: string) {
        VibeManager.assertAbsoluteFilePath(filePath, 'filePath');
        VibeManager.assertString(content, 'content', true);
        this.filePath = filePath;
        this.content = content;
    }

    static async create(filePath: string): Promise<VibeManager> {
        VibeManager.assertAbsoluteFilePath(filePath, 'filePath');
        const content = await fs.readFile(filePath, { encoding: 'utf-8' });
        return new VibeManager(filePath, content);
    }

    private async save(): Promise<void> {
        await fs.writeFile(this.filePath, this.content, { encoding: 'utf-8' });
    }

    // --- UTILITIES ---

    private static assertString(value: string, name: string, allowEmpty = false): void {
        if (typeof value !== 'string') throw new Error(`${name} must be a string`);
        if (!allowEmpty && value.trim().length === 0) throw new Error(`${name} cannot be empty`);
    }

    private static assertAbsoluteFilePath(value: string, name: string): void {
        VibeManager.assertString(value, name);
        if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
    }

    // --- THEME, TRANSITIONS & ANIMATIONS ---

    private getBlock(startMarker: string, endMarker: string): string {
        const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`${escapedStart}\\s*([\\s\\S]*?)\\s*${escapedEnd}`, 'i');
        const match = pattern.exec(this.content);
        return match && match[1] ? match[1].trim() : "";
    }

    private async setBlock(startMarker: string, endMarker: string, newContent: string): Promise<void> {
        const escapedStart = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedEnd = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(${escapedStart})[\\s\\S]*?(${escapedEnd})`, 'i');
        
        if (!pattern.test(this.content)) {
            throw new Error(`Markers ${startMarker} / ${endMarker} not found in template`);
        }
        
        this.content = this.content.replace(pattern, `$1\n        ${newContent.trim()}\n        $2`);
        await this.save();
    }

    getTheme(): string { return this.getBlock('<!-- VIBE_THEME_START -->', '<!-- VIBE_THEME_END -->'); }
    async setTheme(css: string): Promise<void> { await this.setBlock('<!-- VIBE_THEME_START -->', '<!-- VIBE_THEME_END -->', css); }

    getTransitions(): string { return this.getBlock('<!-- VIBE_TRANSITIONS_START -->', '<!-- VIBE_TRANSITIONS_END -->'); }
    async setTransitions(css: string): Promise<void> { await this.setBlock('<!-- VIBE_TRANSITIONS_START -->', '<!-- VIBE_TRANSITIONS_END -->', css); }

    getAnimations(): string { return this.getBlock('<!-- VIBE_ANIMATIONS_START -->', '<!-- VIBE_ANIMATIONS_END -->'); }
    async setAnimations(css: string): Promise<void> { await this.setBlock('<!-- VIBE_ANIMATIONS_START -->', '<!-- VIBE_ANIMATIONS_END -->', css); }

    // --- MANIFEST (JSON STATE) ---

    getManifest(): VibeManifest {
        const json = this.getBlock('<!-- <!-- VIBE_MANIFEST_START --> -->', '<!-- <!-- VIBE_MANIFEST_END --> -->');
        // Fallback for V3 single comment style if double fails
        const fallback = json || this.getBlock('<!-- VIBE_MANIFEST_START -->', '<!-- VIBE_MANIFEST_END -->');
        try {
            return JSON.parse(fallback);
        } catch (e) {
            throw new Error("Failed to parse Vibe Manifest JSON from HTML");
        }
    }

    async setManifest(manifest: VibeManifest): Promise<void> {
        const jsonString = JSON.stringify(manifest, null, 4);
        // Supports both double and single comment V3 styles
        const start = this.content.includes('<!-- <!-- VIBE_MANIFEST_START --> -->') 
            ? '<!-- <!-- VIBE_MANIFEST_START --> -->' 
            : '<!-- VIBE_MANIFEST_START -->';
        const end = this.content.includes('<!-- <!-- VIBE_MANIFEST_END --> -->') 
            ? '<!-- <!-- VIBE_MANIFEST_END --> -->' 
            : '<!-- VIBE_MANIFEST_END -->';

        await this.setBlock(start, end, `<script id="vibe-manifest" type="application/json">\n    ${jsonString}\n    </script>`);
    }

    // --- GLOBAL UI ---

    getGlobalUI(): string { return this.getBlock('<!-- <!-- VIBE_GLOBAL_UI_START --> -->', '<!-- <!-- VIBE_GLOBAL_UI_END --> -->'); }
    async setGlobalUI(html: string): Promise<void> { await this.setBlock('<!-- <!-- VIBE_GLOBAL_UI_START --> -->', '<!-- <!-- VIBE_GLOBAL_UI_END --> -->', html); }

    // --- SLIDE MANAGEMENT (ID & INDEX SUPPORT) ---

    private getSlideMetadata(): { id: string, fullBlock: string, content: string }[] {
        const containerPattern = /<!-- <!-- VIBE_SLIDES_CONTAINER_START --> -->([\s\S]*?)<!-- <!-- VIBE_SLIDES_CONTAINER_END --> -->/;
        const match = containerPattern.exec(this.content);
        if (!match) return [];

        const slidesRegion = match[1];
        // Regex to capture the ID from VIBE_SLIDE_ID:{ID}_START
        const slidePattern = /<!-- VIBE_SLIDE_ID:([\w-]+)_START -->([\s\S]*?)<!-- VIBE_SLIDE_ID:\1_END -->/g;
        const results = [];
        let m;
        while ((m = slidePattern.exec(slidesRegion)) !== null) {
            results.push({
                id: m[1],
                fullBlock: m[0],
                content: m[2].trim()
            });
        }
        return results;
    }

    /**
     * Gets total slide count.
     */
    getSlideCount(): number {
        return this.getSlideMetadata().length;
    }

    /**
     * Retrieves slide HTML. 
     * @param identifier Either the UUID string or the 1-based index.
     */
    getSlide(identifier: string | number): string | null {
        const slides = this.getSlideMetadata();
        if (typeof identifier === 'number') {
            return slides[identifier - 1]?.content || null;
        }
        return slides.find(s => s.id === identifier)?.content || null;
    }

    /**
     * Updates an existing slide.
     */
    async setSlide(identifier: string | number, newHtml: string): Promise<void> {
        const slides = this.getSlideMetadata();
        let targetId: string | undefined;

        if (typeof identifier === 'number') {
            targetId = slides[identifier - 1]?.id;
        } else {
            targetId = identifier;
        }

        if (!targetId) throw new Error(`Slide ${identifier} not found`);

        const pattern = new RegExp(`(<!-- VIBE_SLIDE_ID:${targetId}_START -->)[\\s\\S]*?(<!-- VIBE_SLIDE_ID:${targetId}_END -->)`, 'i');
        this.content = this.content.replace(pattern, `$1\n        ${newHtml.trim()}\n        $2`);
        await this.save();
    }

    /**
     * Appends a new slide with a new UUID.
     */
    async addSlide(newHtml: string, customId?: string): Promise<string> {
        const id = customId || crypto.randomUUID();
        const newBlock = `\n        <!-- VIBE_SLIDE_ID:${id}_START -->\n        ${newHtml.trim()}\n        <!-- VIBE_SLIDE_ID:${id}_END -->\n`;
        
        const containerEnd = '<!-- <!-- VIBE_SLIDES_CONTAINER_END --> -->';
        if (!this.content.includes(containerEnd)) throw new Error("Slide container end marker missing");

        this.content = this.content.replace(containerEnd, `${newBlock}        ${containerEnd}`);
        
        // Update manifest active_slides
        const manifest = this.getManifest();
        manifest.active_slides.push(id);
        await this.setManifest(manifest);
        
        await this.save();
        return id;
    }

    /**
     * Deletes a slide.
     */
    async deleteSlide(identifier: string | number): Promise<void> {
        const slides = this.getSlideMetadata();
        let targetId: string | undefined;

        if (typeof identifier === 'number') {
            targetId = slides[identifier - 1]?.id;
        } else {
            targetId = identifier;
        }

        if (!targetId) throw new Error(`Slide ${identifier} not found`);

        const pattern = new RegExp(`\\s*<!-- VIBE_SLIDE_ID:${targetId}_START -->[\\s\\S]*?<!-- VIBE_SLIDE_ID:${targetId}_END -->\\s*`, 'i');
        this.content = this.content.replace(pattern, '\n');

        // Update manifest
        const manifest = this.getManifest();
        manifest.active_slides = manifest.active_slides.filter(id => id !== targetId);
        await this.setManifest(manifest);

        await this.save();
    }
}