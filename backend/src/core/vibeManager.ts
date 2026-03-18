import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

export interface VibeManifest {
    engine_version: string;
    project_id: string;
    theme_id: string;
    transition_style: string;
    active_slides: string[];
    [key: string]: any;
}

export interface SlideMetadata {
    id: string;
    index: number;
    fullBlock: string;
    content: string;
    startMarker: string;
    endMarker: string;
    legacy: boolean;
}

export interface DeckValidationResult {
    isConsistent: boolean;
    htmlSlideIds: string[];
    manifestSlideIds: string[];
    missingInHtml: string[];
    missingInManifest: string[];
    duplicateIds: string[];
}

export class VibeManager {
    /**
     * Surgical orchestrator for Vibe Slide templates.
     * Supports V3 UUID markers and legacy index markers during migration.
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

    getContentSnapshot(): string {
        return this.content;
    }

    async restoreContentSnapshot(snapshot: string): Promise<void> {
        this.content = snapshot;
        await this.save();
    }

    private async save(): Promise<void> {
        await fs.writeFile(this.filePath, this.content, { encoding: 'utf-8' });
    }

    private static assertString(value: string, name: string, allowEmpty = false): void {
        if (typeof value !== 'string') throw new Error(`${name} must be a string`);
        if (!allowEmpty && value.trim().length === 0) throw new Error(`${name} cannot be empty`);
    }

    private static assertAbsoluteFilePath(value: string, name: string): void {
        VibeManager.assertString(value, name);
        if (!path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
    }

    private static escapeRegex(value: string): string {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    private getMarkerBlock(pairs: Array<{ start: string; end: string }>): { content: string; start: string; end: string } | null {
        for (const pair of pairs) {
            const escapedStart = VibeManager.escapeRegex(pair.start);
            const escapedEnd = VibeManager.escapeRegex(pair.end);
            const pattern = new RegExp(`${escapedStart}\\s*([\\s\\S]*?)\\s*${escapedEnd}`, 'i');
            const match = pattern.exec(this.content);
            if (match) {
                return {
                    content: (match[1] || '').trim(),
                    start: pair.start,
                    end: pair.end
                };
            }
        }

        return null;
    }

    private async setMarkerBlock(pairs: Array<{ start: string; end: string }>, newContent: string): Promise<void> {
        const block = this.getMarkerBlock(pairs);
        if (!block) {
            throw new Error(`Markers not found in template. Tried: ${pairs.map((p) => `${p.start} / ${p.end}`).join(', ')}`);
        }

        const escapedStart = VibeManager.escapeRegex(block.start);
        const escapedEnd = VibeManager.escapeRegex(block.end);
        const pattern = new RegExp(`(${escapedStart})[\\s\\S]*?(${escapedEnd})`, 'i');
        this.content = this.content.replace(pattern, `$1\n        ${newContent.trim()}\n        $2`);
        await this.save();
    }

    private getSlideContainerBlock(): { content: string; start: string; end: string } {
        const block = this.getMarkerBlock([
            {
                start: '<!-- VIBE_SLIDES_CONTAINER_START -->',
                end: '<!-- VIBE_SLIDES_CONTAINER_END -->'
            },
            {
                start: '<!-- <!-- VIBE_SLIDES_CONTAINER_START --> -->',
                end: '<!-- <!-- VIBE_SLIDES_CONTAINER_END --> -->'
            },
        ]);

        if (!block) {
            throw new Error('Slide container markers not found');
        }

        return block;
    }

    private resolveSlide(slides: SlideMetadata[], identifier: string | number): SlideMetadata | undefined {
        if (typeof identifier === 'number') {
            return slides[identifier - 1];
        }

        return slides.find((slide) => slide.id === identifier);
    }

    private getBlock(startMarker: string, endMarker: string): string {
        const escapedStart = VibeManager.escapeRegex(startMarker);
        const escapedEnd = VibeManager.escapeRegex(endMarker);
        const pattern = new RegExp(`${escapedStart}\\s*([\\s\\S]*?)\\s*${escapedEnd}`, 'i');
        const match = pattern.exec(this.content);
        return match && match[1] ? match[1].trim() : '';
    }

    private async setBlock(startMarker: string, endMarker: string, newContent: string): Promise<void> {
        const escapedStart = VibeManager.escapeRegex(startMarker);
        const escapedEnd = VibeManager.escapeRegex(endMarker);
        const pattern = new RegExp(`(${escapedStart})[\\s\\S]*?(${escapedEnd})`, 'i');

        if (!pattern.test(this.content)) {
            throw new Error(`Markers ${startMarker} / ${endMarker} not found in template`);
        }

        this.content = this.content.replace(pattern, `$1\n        ${newContent.trim()}\n        $2`);
        await this.save();
    }

    getTheme(): string {
        const block = this.getMarkerBlock([
            {
                start: '/* <!-- VIBE_THEME_START --> */',
                end: '/* <!-- VIBE_THEME_END --> */'
            },
            {
                start: '<!-- VIBE_THEME_START -->',
                end: '<!-- VIBE_THEME_END -->'
            }
        ]);

        return block?.content || '';
    }

    async setTheme(css: string): Promise<void> {
        await this.setMarkerBlock(
            [
                {
                    start: '/* <!-- VIBE_THEME_START --> */',
                    end: '/* <!-- VIBE_THEME_END --> */'
                },
                {
                    start: '<!-- VIBE_THEME_START -->',
                    end: '<!-- VIBE_THEME_END -->'
                }
            ],
            css
        );
    }

    getTransitions(): string {
        const block = this.getMarkerBlock([
            {
                start: '/* <!-- VIBE_TRANSITIONS_START --> */',
                end: '/* <!-- VIBE_TRANSITIONS_END --> */'
            },
            {
                start: '<!-- VIBE_TRANSITIONS_START -->',
                end: '<!-- VIBE_TRANSITIONS_END -->'
            }
        ]);

        return block?.content || '';
    }

    async setTransitions(css: string): Promise<void> {
        await this.setMarkerBlock(
            [
                {
                    start: '/* <!-- VIBE_TRANSITIONS_START --> */',
                    end: '/* <!-- VIBE_TRANSITIONS_END --> */'
                },
                {
                    start: '<!-- VIBE_TRANSITIONS_START -->',
                    end: '<!-- VIBE_TRANSITIONS_END -->'
                }
            ],
            css
        );
    }

    getAnimations(): string {
        const block = this.getMarkerBlock([
            {
                start: '/* <!-- VIBE_ANIMATIONS_START --> */',
                end: '/* <!-- VIBE_ANIMATIONS_END --> */'
            },
            {
                start: '<!-- VIBE_ANIMATIONS_START -->',
                end: '<!-- VIBE_ANIMATIONS_END -->'
            }
        ]);

        return block?.content || '';
    }

    async setAnimations(css: string): Promise<void> {
        await this.setMarkerBlock(
            [
                {
                    start: '/* <!-- VIBE_ANIMATIONS_START --> */',
                    end: '/* <!-- VIBE_ANIMATIONS_END --> */'
                },
                {
                    start: '<!-- VIBE_ANIMATIONS_START -->',
                    end: '<!-- VIBE_ANIMATIONS_END -->'
                }
            ],
            css
        );
    }

    getManifest(): VibeManifest {
        const manifestBlock = this.getMarkerBlock([
            {
                start: '<!-- VIBE_MANIFEST_START -->',
                end: '<!-- VIBE_MANIFEST_END -->'
            },
            {
                start: '<!-- <!-- VIBE_MANIFEST_START --> -->',
                end: '<!-- <!-- VIBE_MANIFEST_END --> -->'
            },
        ]);

        if (!manifestBlock) {
            throw new Error('Vibe Manifest block not found in HTML');
        }

        const scriptMatch = manifestBlock.content.match(/<script[^>]*id=["']vibe-manifest["'][^>]*>([\s\S]*?)<\/script>/i);
        const payload = scriptMatch?.[1]?.trim() || manifestBlock.content;

        try {
            const parsed = JSON.parse(payload);
            if (!Array.isArray(parsed.active_slides)) {
                parsed.active_slides = [];
            }
            return parsed;
        } catch {
            throw new Error('Failed to parse Vibe Manifest JSON from HTML');
        }
    }

    async setManifest(manifest: VibeManifest): Promise<void> {
        const jsonString = JSON.stringify(manifest, null, 4);
        await this.setMarkerBlock(
            [
                {
                    start: '<!-- VIBE_MANIFEST_START -->',
                    end: '<!-- VIBE_MANIFEST_END -->'
                },
                {
                    start: '<!-- <!-- VIBE_MANIFEST_START --> -->',
                    end: '<!-- <!-- VIBE_MANIFEST_END --> -->'
                },
            ],
            `<script id="vibe-manifest" type="application/json">\n${jsonString}\n</script>`
        );
    }

    getGlobalUI(): string {
        const block = this.getMarkerBlock([
            {
                start: '<!-- VIBE_GLOBAL_UI_START -->',
                end: '<!-- VIBE_GLOBAL_UI_END -->'
            },
            {
                start: '<!-- <!-- VIBE_GLOBAL_UI_START --> -->',
                end: '<!-- <!-- VIBE_GLOBAL_UI_END --> -->'
            },
        ]);

        return block?.content || '';
    }

    async setGlobalUI(html: string): Promise<void> {
        await this.setMarkerBlock(
            [
                {
                    start: '<!-- VIBE_GLOBAL_UI_START -->',
                    end: '<!-- VIBE_GLOBAL_UI_END -->'
                },
                {
                    start: '<!-- <!-- VIBE_GLOBAL_UI_START --> -->',
                    end: '<!-- <!-- VIBE_GLOBAL_UI_END --> -->'
                },
            ],
            html
        );
    }

    listSlides(): SlideMetadata[] {
        const container = this.getSlideContainerBlock();
        const slidesRegion = container.content;

        const idPattern = /<!-- VIBE_SLIDE_ID:([\w-]+)_START -->([\s\S]*?)<!-- VIBE_SLIDE_ID:\1_END -->/g;
        const idSlides: SlideMetadata[] = [];
        let idMatch: RegExpExecArray | null;
        while ((idMatch = idPattern.exec(slidesRegion)) !== null) {
            const matchedId = idMatch[1];
            const matchedContent = idMatch[2];
            if (!matchedId || matchedContent === undefined) {
                continue;
            }

            idSlides.push({
                id: matchedId,
                index: idSlides.length + 1,
                fullBlock: idMatch[0],
                content: matchedContent.trim(),
                startMarker: `<!-- VIBE_SLIDE_ID:${matchedId}_START -->`,
                endMarker: `<!-- VIBE_SLIDE_ID:${matchedId}_END -->`,
                legacy: false
            });
        }

        if (idSlides.length > 0) {
            return idSlides;
        }

        const legacyPattern = /<!-- VIBE_SLIDE_(\d+)_START -->([\s\S]*?)<!-- VIBE_SLIDE_\1_END -->/g;
        const legacySlides: SlideMetadata[] = [];
        let legacyMatch: RegExpExecArray | null;
        while ((legacyMatch = legacyPattern.exec(slidesRegion)) !== null) {
            const matchedIndex = legacyMatch[1];
            const matchedContent = legacyMatch[2];
            if (!matchedIndex || matchedContent === undefined) {
                continue;
            }

            const legacyIndex = Number(matchedIndex);
            legacySlides.push({
                id: `legacy-${legacyIndex}`,
                index: legacySlides.length + 1,
                fullBlock: legacyMatch[0],
                content: matchedContent.trim(),
                startMarker: `<!-- VIBE_SLIDE_${legacyIndex}_START -->`,
                endMarker: `<!-- VIBE_SLIDE_${legacyIndex}_END -->`,
                legacy: true
            });
        }

        return legacySlides;
    }

    getSlideCount(): number {
        return this.listSlides().length;
    }

    getSlide(identifier: string | number): string | null {
        const target = this.resolveSlide(this.listSlides(), identifier);
        return target?.content || null;
    }

    async setSlide(identifier: string | number, newHtml: string): Promise<void> {
        const target = this.resolveSlide(this.listSlides(), identifier);
        if (!target) throw new Error(`Slide ${identifier} not found`);

        const escapedStart = VibeManager.escapeRegex(target.startMarker);
        const escapedEnd = VibeManager.escapeRegex(target.endMarker);
        const pattern = new RegExp(`(${escapedStart})[\\s\\S]*?(${escapedEnd})`, 'i');
        this.content = this.content.replace(pattern, `$1\n        ${newHtml.trim()}\n        $2`);
        await this.save();
    }

    async addSlide(newHtml: string, customId?: string): Promise<string> {
        const id = customId || randomUUID();
        const newBlock = `\n        <!-- VIBE_SLIDE_ID:${id}_START -->\n        ${newHtml.trim()}\n        <!-- VIBE_SLIDE_ID:${id}_END -->\n`;
        const container = this.getSlideContainerBlock();

        this.content = this.content.replace(container.end, `${newBlock}        ${container.end}`);

        const manifest = this.getManifest();
        if (!manifest.active_slides.includes(id)) {
            manifest.active_slides.push(id);
        }
        await this.setManifest(manifest);

        await this.save();
        return id;
    }

    async deleteSlide(identifier: string | number): Promise<void> {
        const target = this.resolveSlide(this.listSlides(), identifier);
        if (!target) throw new Error(`Slide ${identifier} not found`);

        const escapedStart = VibeManager.escapeRegex(target.startMarker);
        const escapedEnd = VibeManager.escapeRegex(target.endMarker);
        const pattern = new RegExp(`\\s*${escapedStart}[\\s\\S]*?${escapedEnd}\\s*`, 'i');
        this.content = this.content.replace(pattern, '\n');

        const manifest = this.getManifest();
        manifest.active_slides = manifest.active_slides.filter((id) => id !== target.id);
        await this.setManifest(manifest);

        await this.save();
    }

    async duplicateSlide(sourceId: string, newId?: string): Promise<string> {
        const source = this.resolveSlide(this.listSlides(), sourceId);
        if (!source) throw new Error(`Slide ${sourceId} not found`);
        return this.addSlide(source.content, newId || randomUUID());
    }

    async reorderManifestSlides(activeSlideIds: string[]): Promise<void> {
        const manifest = this.getManifest();
        manifest.active_slides = [...activeSlideIds];
        await this.setManifest(manifest);
        await this.save();
    }

    validateDeckState(): DeckValidationResult {
        const htmlSlideIds = this.listSlides().map((slide) => slide.id);
        const manifestSlideIds = this.getManifest().active_slides || [];

        const missingInHtml = manifestSlideIds.filter((id) => !htmlSlideIds.includes(id));
        const missingInManifest = htmlSlideIds.filter((id) => !manifestSlideIds.includes(id));

        const seen = new Set<string>();
        const duplicateIds = htmlSlideIds.filter((id) => {
            if (seen.has(id)) return true;
            seen.add(id);
            return false;
        });

        const sameOrder = htmlSlideIds.length === manifestSlideIds.length &&
            htmlSlideIds.every((id, idx) => id === manifestSlideIds[idx]);

        return {
            isConsistent: missingInHtml.length === 0 && missingInManifest.length === 0 && duplicateIds.length === 0 && sameOrder,
            htmlSlideIds,
            manifestSlideIds,
            missingInHtml,
            missingInManifest,
            duplicateIds
        };
    }

    detectTemplateVersion(): 'v2' | 'v3' {
        if (this.content.includes('VIBE_SLIDE_ID:') && this.content.includes('vibe-manifest')) {
            return 'v3';
        }

        return 'v2';
    }

    async migrateToV3(): Promise<{ migrated: boolean; slideIdMap: Array<{ from: string; to: string }> }> {
        if (this.detectTemplateVersion() === 'v3') {
            return { migrated: false, slideIdMap: [] };
        }

        const container = this.getSlideContainerBlock();
        const legacyPattern = /<!-- VIBE_SLIDE_(\d+)_START -->([\s\S]*?)<!-- VIBE_SLIDE_\1_END -->/g;
        const slideIdMap: Array<{ from: string; to: string }> = [];

        const slidesRegion = container.content.replace(legacyPattern, (_full, legacyIndex, inner) => {
            const newId = randomUUID();
            slideIdMap.push({ from: String(legacyIndex), to: newId });
            return `<!-- VIBE_SLIDE_ID:${newId}_START -->\n${inner.trim()}\n<!-- VIBE_SLIDE_ID:${newId}_END -->`;
        });

        this.content = this.content.replace(container.start, '<!-- VIBE_SLIDES_CONTAINER_START -->');
        this.content = this.content.replace(container.end, '<!-- VIBE_SLIDES_CONTAINER_END -->');

        const containerPattern = new RegExp(`(${VibeManager.escapeRegex('<!-- VIBE_SLIDES_CONTAINER_START -->')})[\\s\\S]*?(${VibeManager.escapeRegex('<!-- VIBE_SLIDES_CONTAINER_END -->')})`, 'i');
        this.content = this.content.replace(containerPattern, `$1\n${slidesRegion}\n$2`);

        if (!this.content.includes('VIBE_MANIFEST_START')) {
            const manifest: VibeManifest = {
                engine_version: '3.0.0',
                project_id: 'unknown',
                theme_id: 'default',
                transition_style: 'default',
                active_slides: slideIdMap.map((entry) => entry.to)
            };

            const manifestBlock = `\n    <!-- VIBE_MANIFEST_START -->\n    <script id="vibe-manifest" type="application/json">\n${JSON.stringify(manifest, null, 4)}\n    </script>\n    <!-- VIBE_MANIFEST_END -->\n`;
            if (this.content.includes('</head>')) {
                this.content = this.content.replace('</head>', `${manifestBlock}\n</head>`);
            }
        }

        if (!this.content.includes('VIBE_GLOBAL_UI_START')) {
            this.content = this.content.replace(/(<body[^>]*>)/i, `$1\n    <!-- VIBE_GLOBAL_UI_START -->\n    <!-- VIBE_GLOBAL_UI_END -->\n`);
        }

        await this.save();
        return { migrated: true, slideIdMap };
    }
}
