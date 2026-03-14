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
        this.filePath = filePath;
        this.content = content;
    }

    /**
     * Factory method to asynchronously create a new VibeManager instance.
     * @param filePath The absolute path to the HTML file.
     */
    static async create(filePath: string): Promise<VibeManager> {
        const content = await fs.readFile(filePath, { encoding: 'utf-8' });
        return new VibeManager(filePath, content);
    }

    private async save(): Promise<void> {
        await fs.writeFile(this.filePath, this.content, { encoding: 'utf-8' });
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
        const pattern = /(<!-- VIBE_THEME_START -->).*?(<!-- VIBE_THEME_END -->)/s;
        const replacement = `$1\n        ${newCss.trim()}\n        $2`;
        this.content = this.content.replace(pattern, replacement);
        await this.save();
    }

    // --- SLIDE METHODS ---

    /**
     * Extracts HTML for a specific slide index (1-based).
     */
    getSlide(index: number): string | null {
        const pattern = new RegExp(`<!-- VIBE_SLIDE_${index}_START -->\\s*(.*?)\\s*<!-- VIBE_SLIDE_${index}_END -->`, 's');
        const match = pattern.exec(this.content);
        return match && match[1] ? match[1].trim() : null;
    }

    /**
     * Overwrites a specific slide by index.
     */
    async setSlide(index: number, newHtml: string): Promise<void> {
        const pattern = new RegExp(`(<!-- VIBE_SLIDE_${index}_START -->).*?(<!-- VIBE_SLIDE_${index}_END -->)`, 's');
        const replacement = `$1\n        ${newHtml.trim()}\n        $2`;
        this.content = this.content.replace(pattern, replacement);
        await this.save();
    }

    /**
     * Appends a new slide to the deck.
     */
    async addSlide(newHtml: string): Promise<void> {
        // Find all slide start markers
        const pattern = /<!-- VIBE_SLIDE_(\d+)_START -->/g;
        let match;
        const indices: number[] = [];
        
        while ((match = pattern.exec(this.content)) !== null) {
            if (match[1]) indices.push(parseInt(match[1], 10));
        }
        
        const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;
        
        const newBlock = `\n        <!-- VIBE_SLIDE_${nextIndex}_START -->\n        ${newHtml.trim()}\n        <!-- VIBE_SLIDE_${nextIndex}_END -->\n`;
        
        this.content = this.content.replace("<!-- VIBE_SLIDES_CONTAINER_END -->", `${newBlock}        <!-- VIBE_SLIDES_CONTAINER_END -->`);
        await this.save();
    }

    /**
     * Removes a slide and its markers.
     */
    async deleteSlide(index: number): Promise<void> {
        const pattern = new RegExp(`\\s*<!-- VIBE_SLIDE_${index}_START -->.*?<!-- VIBE_SLIDE_${index}_END -->`, 's');
        this.content = this.content.replace(pattern, "");
        await this.save();
    }

    /**
     * Gets the total number of slides currently in the deck.
     */
    getSlideCount(): number {
        const pattern = /<!-- VIBE_SLIDE_(\d+)_START -->/g;
        let match;
        const indices: number[] = [];
        
        while ((match = pattern.exec(this.content)) !== null) {
            if (match[1]) indices.push(parseInt(match[1], 10));
        }
        
        return indices.length;
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
        const pattern = /(<!-- VIBE_SCRIPT_START -->).*?(<!-- VIBE_SCRIPT_END -->)/s;
        const replacement = `$1\n        ${newJs.trim()}\n        $2`;
        this.content = this.content.replace(pattern, replacement);
        await this.save();
    }
}
