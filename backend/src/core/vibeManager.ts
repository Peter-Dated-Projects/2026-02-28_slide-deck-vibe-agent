import * as fs from 'fs/promises';
import * as path from 'path';

export class VibeManager {
    /**
     * Surgical Orchestrator for Vibe Slide HTML files.
     * Uses regex to read/write specific regions without disturbing the core engine.
     */
    private filePath: string;
    private content: string;

    private constructor(filePath: string, content: string) {
        VibeManager.assertAbsoluteFilePath(filePath, 'filePath');
        VibeManager.assertString(content, 'content', true);
        this.filePath = filePath;
        this.content = content;
    }

    /**
     * Factory method to asynchronously create a new VibeManager instance.
     * @param filePath The absolute path to the HTML file.
     */
    static async create(filePath: string): Promise<VibeManager> {
        VibeManager.assertAbsoluteFilePath(filePath, 'filePath');
        const content = await fs.readFile(filePath, { encoding: 'utf-8' });
        return new VibeManager(filePath, content);
    }

    private async save(): Promise<void> {
        await fs.writeFile(this.filePath, this.content, { encoding: 'utf-8' });
    }

    private static assertString(value: string, name: string, allowEmpty = false): void {
        if (typeof value !== 'string') {
            throw new Error(`${name} must be a string`);
        }

        if (!allowEmpty && value.trim().length === 0) {
            throw new Error(`${name} cannot be empty`);
        }
    }

    private static assertPositiveInteger(value: number, name: string): void {
        if (!Number.isInteger(value) || value < 1) {
            throw new Error(`${name} must be a positive integer`);
        }
    }

    private static assertAbsoluteFilePath(value: string, name: string): void {
        VibeManager.assertString(value, name);
        if (!path.isAbsolute(value)) {
            throw new Error(`${name} must be an absolute path`);
        }
    }

    private getSlideBlocks(requireContainer = false): string[] {
        const containerPattern = /<!-- VIBE_SLIDES_CONTAINER_START -->([\s\S]*?)<!-- VIBE_SLIDES_CONTAINER_END -->/;
        const containerMatch = containerPattern.exec(this.content);

        if (!containerMatch || containerMatch[1] === undefined) {
            if (requireContainer) {
                throw new Error('Slides container markers not found');
            }
            return [];
        }

        const slidesRegion = containerMatch[1];
        const slidePattern = /<!-- VIBE_SLIDE_(\d+)_START -->\s*([\s\S]*?)\s*<!-- VIBE_SLIDE_\1_END -->/g;
        const blocks: string[] = [];
        let match: RegExpExecArray | null = null;

        while ((match = slidePattern.exec(slidesRegion)) !== null) {
            if (match[2] !== undefined) {
                blocks.push(match[2].trim());
            }
        }

        return blocks;
    }

    private replaceSlideBlocks(blocks: string[]): void {
        const containerPattern = /(<!-- VIBE_SLIDES_CONTAINER_START -->)([\s\S]*?)(<!-- VIBE_SLIDES_CONTAINER_END -->)/;
        if (!containerPattern.test(this.content)) {
            throw new Error('Slides container markers not found');
        }

        const renderedSlides = blocks
            .map((block, idx) => {
                const slideIndex = idx + 1;
                return `\n        <!-- VIBE_SLIDE_${slideIndex}_START -->\n        ${block.trim()}\n        <!-- VIBE_SLIDE_${slideIndex}_END -->\n`;
            })
            .join('\n');

        this.content = this.content.replace(
            containerPattern,
            `$1\n${renderedSlides}\n        $3`,
        );
    }

    // --- THEME METHODS ---

    /**
     * Extracts the CSS variables block.
     */
    getTheme(): string {
        const pattern = /<!-- VIBE_THEME_START -->\s*(.*?)\s*<!-- VIBE_THEME_END -->/s;
        const match = pattern.exec(this.content);
        return match && match[1] ? match[1].trim() : "";
    }

    /**
     * Overwrites the CSS variables block.
     * @param newCss The new CSS string to insert.
     */
    async setTheme(newCss: string): Promise<void> {
        VibeManager.assertString(newCss, 'newCss');
        const pattern = /(<!-- VIBE_THEME_START -->).*?(<!-- VIBE_THEME_END -->)/s;
        if (!pattern.test(this.content)) {
            throw new Error('Theme markers not found');
        }
        const replacement = `$1\n        ${newCss.trim()}\n        $2`;
        this.content = this.content.replace(pattern, replacement);
        await this.save();
    }

    // --- SLIDE METHODS ---

    /**
     * Extracts inner HTML content for a specific slide index (1-based).
     * Returns only the content inside <section class="slide">, not the section wrapper itself.
     */
    getSlide(index: number): string | null {
        VibeManager.assertPositiveInteger(index, 'index');
        const pattern = new RegExp(`<!-- VIBE_SLIDE_${index}_START -->\\s*(.*?)\\s*<!-- VIBE_SLIDE_${index}_END -->`, 's');
        const match = pattern.exec(this.content);
        if (!match || !match[1]) return null;

        const sectionPattern = /<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>([\s\S]*?)<\/section>/i;
        const sectionMatch = sectionPattern.exec(match[1]);
        return sectionMatch && sectionMatch[1] ? sectionMatch[1].trim() : null;
    }

    /**
     * Overwrites the inner HTML content of a specific slide by index.
     * Only content inside <section class="slide"> is replaced.
     */
    async setSlide(index: number, newHtml: string): Promise<void> {
        VibeManager.assertPositiveInteger(index, 'index');
        VibeManager.assertString(newHtml, 'newHtml');
        const pattern = new RegExp(`(<!-- VIBE_SLIDE_${index}_START -->\\s*)([\\s\\S]*?)(\\s*<!-- VIBE_SLIDE_${index}_END -->)`, 's');
        const match = pattern.exec(this.content);
        if (!match || !match[2]) {
            throw new Error(`Slide ${index} not found`);
        }

        const sectionPattern = /(<section\b[^>]*\bclass\s*=\s*["'][^"']*\bslide\b[^"']*["'][^>]*>)([\s\S]*?)(<\/section>)/i;
        if (!sectionPattern.test(match[2])) {
            throw new Error(`Slide ${index} does not contain a valid <section class=\"slide\"> block`);
        }

        const updatedSlideBlock = match[2].replace(sectionPattern, `$1\n${newHtml.trim()}\n$3`);
        this.content = this.content.replace(pattern, `$1${updatedSlideBlock}$3`);
        await this.save();
    }

    /**
     * Appends a new slide to the deck.
     */
    async addSlide(newHtml: string): Promise<void> {
        VibeManager.assertString(newHtml, 'newHtml');
        const blocks = this.getSlideBlocks(true);
        blocks.push(newHtml.trim());
        this.replaceSlideBlocks(blocks);
        await this.save();
    }

    /**
     * Inserts a new slide into the deck
     */
    async insertSlide(index: number, newHtml: string): Promise<void> {
        VibeManager.assertPositiveInteger(index, 'index');
        VibeManager.assertString(newHtml, 'newHtml');

        const blocks = this.getSlideBlocks(true);
        if (index > blocks.length + 1) {
            throw new Error(`index must be between 1 and ${blocks.length + 1}`);
        }

        blocks.splice(index - 1, 0, newHtml.trim());
        this.replaceSlideBlocks(blocks);
        await this.save();
    }

    /**
     * Removes a slide and its markers.
     */
    async deleteSlide(index: number): Promise<void> {
        VibeManager.assertPositiveInteger(index, 'index');
        const blocks = this.getSlideBlocks(true);
        if (index > blocks.length) {
            throw new Error(`Slide ${index} not found`);
        }

        blocks.splice(index - 1, 1);
        this.replaceSlideBlocks(blocks);
        await this.save();
    }

    /**
     * Gets the total number of slides currently in the deck.
     */
    getSlideCount(): number {
        return this.getSlideBlocks(false).length;
    }

    // --- SCRIPT METHODS ---

    /**
     * Extracts the JavaScript block.
     */
    getScript(): string {
        const pattern = /<!-- VIBE_SCRIPT_START -->\s*(.*?)\s*<!-- VIBE_SCRIPT_END -->/s;
        const match = pattern.exec(this.content);
        return match && match[1] ? match[1].trim() : "";
    }

    /**
     * Overwrites the JavaScript block.
     * @param newJs The new JavaScript string to insert.
     */
    async setScript(newJs: string): Promise<void> {
        VibeManager.assertString(newJs, 'newJs');
        const pattern = /(<!-- VIBE_SCRIPT_START -->).*?(<!-- VIBE_SCRIPT_END -->)/s;
        if (!pattern.test(this.content)) {
            throw new Error('Script markers not found');
        }
        const replacement = `$1\n        ${newJs.trim()}\n        $2`;
        this.content = this.content.replace(pattern, replacement);
        await this.save();
    }
}
