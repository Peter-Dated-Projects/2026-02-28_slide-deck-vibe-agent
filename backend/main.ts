import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import * as authController from './src/controllers/auth';
import * as userController from './src/controllers/user';
import * as projectController from './src/controllers/project';
import { requireAuth, type AuthRequest } from './src/middleware/auth';
import { dbService as db } from './src/core/container';
import { chatWithAgent, processToolCall } from './src/services/agent';
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
        
        let messagesContext: any[] = historyResult.rows.map((row: any) => ({
            role: row.role as string,
            content: (row.content as any).text || row.content // Handle both string and complex block structures
        }));

        // Call Claude
        let claudeResponse = await chatWithAgent(currentConvId, messagesContext);
        
        // Handle Iterative Tool Calls loop (up to 5 iterations to prevent infinite loops)
        let iterations = 0;
        while (claudeResponse.stop_reason === 'tool_use' && iterations < 5) {
            iterations++;
            
            // Save Assistant's tool request
            await db.query(
                 'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
                 [currentConvId, 'assistant', JSON.stringify(claudeResponse.content)]
            );
             messagesContext.push({ role: 'assistant', content: claudeResponse.content });

            // Process Tools
            const toolResults = [];
            for (const content of claudeResponse.content) {
                if (content.type === 'tool_use') {
                    const result = await processToolCall(content, currentConvId);
                    toolResults.push(result);
                }
            }

            // Save Tool Results
            await db.query(
                'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
                [currentConvId, 'tool', JSON.stringify(toolResults)]
           );
           messagesContext.push({ role: 'tool', content: toolResults });

            // Send back to Claude
            claudeResponse = await chatWithAgent(currentConvId, messagesContext);
        }

        // Save Final Assistant Response
        if (claudeResponse.content.length > 0) {
             await db.query(
                'INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)',
                [currentConvId, 'assistant', JSON.stringify(claudeResponse.content)]
            );
        }

        res.json({
             conversationId: currentConvId,
             response: claudeResponse.content
        });

    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Internal server error processing chat' });
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
