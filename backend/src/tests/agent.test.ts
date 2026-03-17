const { chatWithAgent } = require('../services/agent');
const { llmService } = require('../core/container');

jest.mock('../core/container', () => ({
    llmService: {
        chatWithAgent: jest.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'Hello!' }],
            stop_reason: 'end_turn'
        })
    },
    dbService: {
        query: jest.fn().mockResolvedValue({
            rows: [{ project_id: '00000000-0000-0000-0000-000000000001' }]
        })
    }
}));

jest.mock('../services/projectDeck', () => ({
    loadDeckHtmlForProject: jest.fn().mockResolvedValue({
        html: `<!doctype html>
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
        <!-- VIBE_SLIDE_ID:11111111-1111-4111-8111-111111111111_START -->
        <section class="slide"><h1>Hello</h1></section>
        <!-- VIBE_SLIDE_ID:11111111-1111-4111-8111-111111111111_END -->
        <!-- <!-- VIBE_SLIDES_CONTAINER_END --> -->
    </div>
    <!-- <!-- VIBE_MANIFEST_START --> -->
    <script id="vibe-manifest" type="application/json">
    {
        "engine_version": "3.0.0",
        "project_id": "test-project",
        "theme_id": "default",
        "transition_style": "fade",
        "active_slides": ["11111111-1111-4111-8111-111111111111"]
    }
    </script>
    <!-- <!-- VIBE_MANIFEST_END --> -->
</body>
</html>`,
        s3Key: 'test/key.html',
        cacheHit: false
    }),
    saveDeckHtmlForProject: jest.fn().mockResolvedValue('test/key.html')
}));

describe('Agent Services', () => {
    it('should proxy chatWithAgent correctly', async () => {
        const messages = [{ role: 'user', content: 'Hello' }];
        const result = await chatWithAgent('conv_123', messages);

        expect(result.stop_reason).toBe('end_turn');
        expect(result.content[0].text).toBe('Hello!');
        expect(llmService.chatWithAgent).toHaveBeenCalledTimes(1);

        const [conversationId, sentMessages, tools, systemInstruction] = (llmService.chatWithAgent as jest.Mock).mock.calls[0];
        expect(conversationId).toBe('conv_123');
        expect(sentMessages).toEqual(messages);
        expect(Array.isArray(tools)).toBe(true);
        expect(systemInstruction).toContain('read_slide');
    });
});
