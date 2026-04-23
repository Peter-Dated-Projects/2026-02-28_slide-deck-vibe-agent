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

/**
 * Layout Extractor
 *
 * Extracts the bounding box tree of all visible elements from a slide
 * rendered inside a sandboxed iframe. Since the iframe uses sandbox="allow-scripts"
 * without allow-same-origin, we cannot access its DOM directly. Instead:
 *
 * 1. We inject a small extraction script into the iframe's HTML via `srcdoc`.
 * 2. The script listens for a `postMessage("extract-layout")` from the parent.
 * 3. It traverses the DOM, computes `getBoundingClientRect()` for each element,
 *    and posts the resulting tree back to the parent.
 * 4. The parent collects the result and resolves the Promise.
 */

export interface LayoutNode {
    tag: string;
    id?: string;
    classes?: string[];
    text?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    children: LayoutNode[];
}

export interface LayoutData {
    slideId: string;
    viewportWidth: number;
    viewportHeight: number;
    tree: LayoutNode;
}

/**
 * The script that gets injected into the iframe's HTML.
 * It listens for a postMessage and responds with the layout tree.
 */
export const LAYOUT_EXTRACTION_SCRIPT = `
<script data-layout-extractor="true">
(function() {
    function buildTree(el, depth) {
        if (depth > 15) return null; // safety cap
        var rect = el.getBoundingClientRect();
        // Skip zero-size and invisible elements
        if (rect.width === 0 && rect.height === 0) return null;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return null;
        // Skip the injected script itself
        if (el.tagName === 'SCRIPT') return null;

        var node = {
            tag: el.tagName.toLowerCase(),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            children: []
        };

        if (el.id) node.id = el.id;
        if (el.classList && el.classList.length > 0) {
            node.classes = Array.from(el.classList);
        }

        // Collect direct text content (not from children)
        var directText = '';
        for (var i = 0; i < el.childNodes.length; i++) {
            if (el.childNodes[i].nodeType === 3) { // TEXT_NODE
                var t = el.childNodes[i].textContent.trim();
                if (t) directText += (directText ? ' ' : '') + t;
            }
        }
        if (directText) {
            node.text = directText.substring(0, 200); // cap text length
        }

        for (var j = 0; j < el.children.length; j++) {
            var childNode = buildTree(el.children[j], depth + 1);
            if (childNode) node.children.push(childNode);
        }
        return node;
    }

    window.addEventListener('message', function(event) {
        if (event.data && event.data.type === 'extract-layout') {
            try {
                var root = document.body || document.documentElement;
                var tree = buildTree(root, 0);
                var result = {
                    type: 'layout-result',
                    requestId: event.data.requestId,
                    viewportWidth: window.innerWidth || document.documentElement.clientWidth || 1920,
                    viewportHeight: window.innerHeight || document.documentElement.clientHeight || 1080,
                    tree: tree || { tag: 'body', x: 0, y: 0, width: 0, height: 0, children: [] }
                };
                event.source.postMessage(result, '*');
            } catch (err) {
                event.source.postMessage({
                    type: 'layout-error',
                    requestId: event.data.requestId,
                    error: err.message || 'Unknown extraction error'
                }, '*');
            }
        }
    });
})();
</script>
`;

/**
 * Inject the layout extraction script into raw HTML if it isn't already present.
 * This should be called before setting the iframe's srcdoc.
 */
export function injectLayoutExtractor(html: string): string {
    if (html.includes('data-layout-extractor="true"')) {
        return html; // already injected
    }
    // Inject right before </body> if present, otherwise append
    if (html.includes('</body>')) {
        return html.replace('</body>', `${LAYOUT_EXTRACTION_SCRIPT}\n</body>`);
    }
    return html + LAYOUT_EXTRACTION_SCRIPT;
}

/**
 * Request layout extraction from a slide iframe.
 *
 * @param iframe - The iframe element rendering the slide.
 * @param requestId - The backend's request ID to correlate the response.
 * @param timeoutMs - How long to wait before rejecting (default 10s).
 * @returns The layout data from the iframe.
 */
export function extractLayoutFromIframe(
    iframe: HTMLIFrameElement,
    requestId: string,
    timeoutMs = 10_000
): Promise<{ viewportWidth: number; viewportHeight: number; tree: LayoutNode }> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error('Layout extraction timed out'));
        }, timeoutMs);

        function handler(event: MessageEvent) {
            if (!event.data || typeof event.data !== 'object') return;
            if (event.data.requestId !== requestId) return;

            if (event.data.type === 'layout-result') {
                clearTimeout(timer);
                window.removeEventListener('message', handler);
                resolve({
                    viewportWidth: event.data.viewportWidth,
                    viewportHeight: event.data.viewportHeight,
                    tree: event.data.tree,
                });
            } else if (event.data.type === 'layout-error') {
                clearTimeout(timer);
                window.removeEventListener('message', handler);
                reject(new Error(event.data.error || 'Layout extraction failed'));
            }
        }

        window.addEventListener('message', handler);

        // Send the extraction request to the iframe
        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage(
                { type: 'extract-layout', requestId },
                '*'
            );
        } else {
            clearTimeout(timer);
            window.removeEventListener('message', handler);
            reject(new Error('Iframe contentWindow is not available'));
        }
    });
}
