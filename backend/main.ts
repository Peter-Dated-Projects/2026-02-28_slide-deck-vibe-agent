import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as authController from './src/controllers/auth';
import * as userController from './src/controllers/user';
import * as projectController from './src/controllers/project';
import { requireAuth, type AuthRequest } from './src/middleware/auth';
import { dbService as db } from './src/core/container';
import { chatWithAgent } from './src/services/agent';
import { config } from './src/config';

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Auth Routes
app.post('/api/auth/google', authController.googleAuth);
app.post('/api/auth/refresh', authController.refreshToken);
app.post('/api/auth/logout', authController.logout);

// User Routes
app.get('/api/user/me', requireAuth, userController.getMe);
app.put('/api/user/me', requireAuth, userController.updateMe);
app.patch('/api/user/profile', requireAuth, userController.updateProfile);
app.delete('/api/user/me', requireAuth, userController.deleteUser);

// Project Routes
app.get('/api/projects', requireAuth, projectController.getProjects);
app.post('/api/projects', requireAuth, projectController.createProject);

// Agent Chat Route
app.post('/api/chat', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const { message, conversationId } = req.body;
        const userId = req.user!.userId;

        if (!message) {
            res.status(400).json({ error: 'Message is required' });
            return;
        }

        let currentConvId = conversationId;

        // Create conversation if it doesn't exist
        if (!currentConvId) {
            const convResult = await db.query(
                'INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id',
                [userId, message.substring(0, 50) + '...']
            );
            currentConvId = convResult.rows[0].id;
        }

        // Save user message
        await db.query(
            'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [currentConvId, 'user', JSON.stringify({ text: message })]
        );

        // Fetch conversation history
        const historyResult = await db.query(
            'SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [currentConvId]
        );
        
        let messagesContext: any[] = historyResult.rows.map((row: any) => {
            const raw = row.content;
            let text: string;
            if (typeof raw === 'string') {
                text = raw;
            } else if (raw?.text) {
                // user messages: { text: "..." }
                text = raw.text;
            } else if (Array.isArray(raw)) {
                // assistant messages: [{ type: 'text', text: '...' }]
                text = raw.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
            } else {
                text = JSON.stringify(raw);
            }
            return { role: row.role as string, content: text };
        });

        // Call Agent
        let agentResponse = await chatWithAgent(currentConvId, messagesContext);
        
        // Save Final Assistant Response
        if (agentResponse.content.length > 0) {
             await db.query(
                'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
                [currentConvId, 'assistant', JSON.stringify(agentResponse.content)]
            );
        }

        res.json({
             conversationId: currentConvId,
             response: agentResponse.content
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Internal server error processing chat' });
    }
});

// Conversation Message History Route (Protected)
app.get('/api/conversations/:conversationId/messages', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
    try {
        const { conversationId } = req.params;
        const userId = req.user!.userId;

        // Verify ownership
        const convResult = await db.query(
            'SELECT user_id FROM conversations WHERE id = $1',
            [conversationId]
        );
        if (convResult.rows.length === 0 || convResult.rows[0].user_id !== userId) {
            res.status(404).json({ error: 'Conversation not found' });
            return;
        }

        const messagesResult = await db.query(
            'SELECT id, role, content, created_at FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [conversationId]
        );

        const messages = messagesResult.rows.map((row: any) => {
            // content is stored as JSONB — extract text from the stored shape
            const rawContent = row.content;
            let text = '';
            if (typeof rawContent === 'string') {
                text = rawContent;
            } else if (rawContent?.text) {
                // user messages: { text: "..." }
                text = rawContent.text;
            } else if (Array.isArray(rawContent)) {
                // assistant messages: [{ type: 'text', text: '...' }]
                text = rawContent
                    .filter((b: any) => b.type === 'text')
                    .map((b: any) => b.text)
                    .join('\n');
            }
            return {
                id: row.id,
                role: row.role,
                content: text,
                createdAt: row.created_at,
            };
        });

        res.json({ messages });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Error fetching conversation messages' });
    }
});

// Presentation Data Route (Protected)
app.get('/api/presentation/:conversationId', requireAuth, async (req: AuthRequest, res: express.Response): Promise<void> => {
     try {
         const { conversationId } = req.params;
         const userId = req.user!.userId;

         const convResult = await db.query('SELECT user_id FROM conversations WHERE id = $1', [conversationId]);
         if (convResult.rows.length === 0 || convResult.rows[0].user_id !== userId) {
             res.status(404).json({ error: 'Presentation not found' });
             return;
         }

         const slidesResult = await db.query('SELECT minio_object_key, theme_data FROM slides WHERE conversation_id = $1 ORDER BY created_at ASC', [conversationId]);
         
         res.json({
             slides: slidesResult.rows
         });
     } catch (error) {
         res.status(500).json({ error: 'Error fetching presentation' });
     }
});


if (require.main === module) {
    app.listen(config.port, () => {
      console.log(`Backend server running on port ${config.port}`);
    });
}

export default app;
