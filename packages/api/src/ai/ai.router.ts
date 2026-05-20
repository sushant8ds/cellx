import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { chat, clearSession, type DataProfile } from './ai.service';
import { randomUUID } from 'crypto';

export const aiRouter = Router();

aiRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// POST /tenants/:tenantId/ai/chat
// Streams the AI response as Server-Sent Events
aiRouter.post('/:tenantId/ai/chat', requirePermission('schema:write'),
  async (req: Request, res: Response): Promise<void> => {
    const tenantId = req.params['tenantId'] as string;
    const { message, sessionId, dataProfile } = req.body as {
      message: string;
      sessionId?: string;
      dataProfile?: DataProfile;
    };

    if (!message?.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    const sid = sessionId ?? randomUUID();

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Session-Id', sid);
    res.flushHeaders();

    try {
      for await (const chunk of chat(tenantId, sid, message, dataProfile)) {
        res.write(`event: ${chunk.type}\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write(`event: done\ndata: ${JSON.stringify({ sessionId: sid })}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ content: String(err) })}\n\n`);
    } finally {
      res.end();
    }
  });

// DELETE /tenants/:tenantId/ai/sessions/:sessionId
aiRouter.delete('/:tenantId/ai/sessions/:sessionId', requirePermission('schema:write'),
  (req: Request, res: Response): void => {
    clearSession(req.params['tenantId'] as string, req.params['sessionId'] as string);
    res.status(204).send();
  });
