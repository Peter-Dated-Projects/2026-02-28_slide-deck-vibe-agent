import type { IStorageService } from './interfaces/IStorageService';

export interface DeckMetadata {
    slideOrder: number[];
}

export class VibeManager {
    /**
     * Surgical Orchestrator for Vibe Slide HTML files.
     * Uses regex to read/write specific regions without disturbing the core engine.
     */
    private s3Key: string;
    private content: string;
    private storage: IStorageService;

    private constructor(s3Key: string, content: string, storage: IStorageService) {
        this.s3Key = s3Key;
        this.content = content;
        this.storage = storage;
    }

    /**
     * Factory method to asynchronously create a new VibeManager instance.
     * @param s3Key The object key in the storage bucket.
     * @param storage The storage service instance.
     */
    static async create(s3Key: string, storage: IStorageService): Promise<VibeManager> {
        const content = await storage.getFileContent(s3Key);
        return new VibeManager(s3Key, content, storage);
    }

    private async save(): Promise<void> {
        await this.storage.uploadFile(this.s3Key, this.content, 'text/html');
    }

    // --- METADATA & CONTEXT METHODS ---

    getMetadata(): DeckMetadata {
        const pattern = /<!-- VIBE_META_START -->\s*(.*?)\s*<!-- VIBE_META_END -->/s;
        const match = pattern.exec(this.content);
        if (match && match[1]) {
            try { return JSON.parse(match[1]!.trim()); } catch (e) { /* fallback */ }
        }
        
        // Fallback: derive from existing markers
        const slidePattern = /<!-- VIBE_SLIDE_(\d+)_START -->/g;
        let pMatch;
        const indices: number[] = [];
        while ((pMatch = slidePattern.exec(this.content)) !== null) {
            if (pMatch[1]) indices.push(parseInt(pMatch[1], 10));
        }
        return { slideOrder: indices };
    }

    async setMetadata(meta: DeckMetadata): Promise<void> {
        const metaJson = JSON.stringify(meta, null, 4);
        const newBlock = `<!-- VIBE_META_START -->\n${metaJson}\n<!-- VIBE_META_END -->`;
        const pattern = /(<!-- VIBE_META_START -->.*?<!-- VIBE_META_END -->)/s;
        
        if (pattern.test(this.content)) {
            this.content = this.content.replace(pattern, newBlock);
        } else {
            // Inject right after theme, or at the start of container if possible
            const themePattern = /(<!-- VIBE_THEME_END -->)/s;
            if (themePattern.test(this.content)) {
                this.content = this.content.replace(themePattern, `$1\n\n${newBlock}\n`);
            } else {
                this.content = newBlock + "\n\n" + this.content;
            }
        }
        await this.save();
    }

    getDeckStructure(): { id: number, title: string }[] {
        const structure: { id: number, title: string }[] = [];
        const meta = this.getMetadata();

        for (const id of meta.slideOrder) {
            const slideHtml = this.getSlide(id);
            if (!slideHtml) continue;

            const headingMatch = /<h[1-6][^>]*>(.*?)<\/h[1-6]>/i.exec(slideHtml);
            let title = headingMatch ? headingMatch[1].replace(/<[^>]+>/g, '').trim() : "Untitled Slide";
            
            structure.push({ id, title });
        }
        
        return structure;
    }

    searchSlides(query: string): { id: number, snippet: string }[] {
        const results: { id: number, snippet: string }[] = [];
        const meta = this.getMetadata();
        const lowerQuery = query.toLowerCase();

        for (const id of meta.slideOrder) {
            const slideHtml = this.getSlide(id);
            if (!slideHtml) continue;
            
            const textContent = slideHtml.replace(/<[^>]+>/g, ' ');

            if (textContent.toLowerCase().includes(lowerQuery)) {
                const matchIndex = textContent.toLowerCase().indexOf(lowerQuery);
                const start = Math.max(0, matchIndex - 30);
                const end = Math.min(textContent.length, matchIndex + query.length + 30);
                results.push({ id, snippet: "..." + textContent.substring(start, end).trim() + "..." });
            }
        }
        return results;
    }

    readGlobalTheme(): string {
        return this.getTheme();
    }

    // --- THEME METHODS ---

    /**
     * Extracts the CSS variables block.
     */
    getTheme(): string {
        const pattern = /<!-- VIBE_THEME_START -->\s*(.*?)\s*<!-- VIBE_THEME_END -->/s;
        const match = pattern.exec(this.content);
        return (match && match[1]) ? match[1].trim() : "";
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
     * Extracts HTML for a specific slide id.
     */
    getSlide(id: number): string | null {
        const pattern = new RegExp(`<!-- VIBE_SLIDE_${id}_START -->\\s*(.*?)\\s*<!-- VIBE_SLIDE_${id}_END -->`, 's');
        const match = pattern.exec(this.content);
        return (match && match[1]) ? match[1].trim() : null;
    }

    /**
     * Overwrites a specific slide by id.
     */
    async setSlide(id: number, newHtml: string): Promise<void> {
        const pattern = new RegExp(`(<!-- VIBE_SLIDE_${id}_START -->).*?(<!-- VIBE_SLIDE_${id}_END -->)`, 's');
        const replacement = `$1\n        ${newHtml.trim()}\n        $2`;
        this.content = this.content.replace(pattern, replacement);
        await this.save();
    }

    /**
     * Appends a new slide to the deck.
     */
    async addSlide(newHtml: string): Promise<void> {
        const meta = this.getMetadata();
        
        const pattern = /<!-- VIBE_SLIDE_(\d+)_START -->/g;
        let match;
        const allIds: number[] = [];
        
        while ((match = pattern.exec(this.content)) !== null) {
            if (match[1]) allIds.push(parseInt(match[1], 10));
        }
        
        const nextId = allIds.length > 0 ? Math.max(...allIds) + 1 : 1;
        
        const newBlock = `\n        <!-- VIBE_SLIDE_${nextId}_START -->\n        ${newHtml.trim()}\n        <!-- VIBE_SLIDE_${nextId}_END -->\n`;
        
        this.content = this.content.replace("<!-- VIBE_SLIDES_CONTAINER_END -->", `${newBlock}        <!-- VIBE_SLIDES_CONTAINER_END -->`);
        
        meta.slideOrder.push(nextId);
        await this.setMetadata(meta);
    }

    /**
     * Inserts a slide at a specific position defined by the metadata order.
     */
    async insertSlideAt(position: number, newHtml: string): Promise<void> {
        const meta = this.getMetadata();
        
        const pattern = /<!-- VIBE_SLIDE_(\d+)_START -->/g;
        let match;
        const allIds: number[] = [];
        
        while ((match = pattern.exec(this.content)) !== null) {
            if (match[1]) allIds.push(parseInt(match[1], 10));
        }
        
        const nextId = allIds.length > 0 ? Math.max(...allIds) + 1 : 1;
        
        const newBlock = `\n        <!-- VIBE_SLIDE_${nextId}_START -->\n        ${newHtml.trim()}\n        <!-- VIBE_SLIDE_${nextId}_END -->\n`;
        
        this.content = this.content.replace("<!-- VIBE_SLIDES_CONTAINER_END -->", `${newBlock}        <!-- VIBE_SLIDES_CONTAINER_END -->`);
        
        meta.slideOrder.splice(position, 0, nextId);
        await this.setMetadata(meta);
    }

    /**
     * Reorders a slide in the metadata
     */
    async reorderSlide(id: number, newPosition: number): Promise<void> {
        const meta = this.getMetadata();
        const currentIndex = meta.slideOrder.indexOf(id);
        if (currentIndex === -1) return; // Not found

        meta.slideOrder.splice(currentIndex, 1);
        meta.slideOrder.splice(newPosition, 0, id);
        await this.setMetadata(meta);
    }

    /**
     * Removes a slide and its markers.
     */
    async deleteSlide(id: number): Promise<void> {
        const pattern = new RegExp(`\\s*<!-- VIBE_SLIDE_${id}_START -->.*?<!-- VIBE_SLIDE_${id}_END -->`, 's');
        this.content = this.content.replace(pattern, "");

        const meta = this.getMetadata();
        meta.slideOrder = meta.slideOrder.filter(existingId => existingId !== id);
        await this.setMetadata(meta);
    }
}
