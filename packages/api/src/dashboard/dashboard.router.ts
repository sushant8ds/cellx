import { Router, Request, Response } from 'express';
import { AuthMiddleware, TenantIsolationMiddleware } from '../middleware/auth.middleware';
import { requirePermission } from '../middleware/rbac.middleware';
import { getDashboardCounts } from './dashboard.service';
import { registerClient, unregisterClient } from './sse.service';

export const dashboardRouter = Router();

dashboardRouter.use(AuthMiddleware, TenantIsolationMiddleware);

// GET /tenants/:tenantId/dashboard
dashboardRouter.get('/:tenantId/dashboard', requirePermission('dashboard:read'),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const tenantId = req.params['tenantId'] as string;
      const counts = await getDashboardCounts(tenantId);
      res.json(counts);
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

// GET /tenants/:tenantId/events/stream — SSE endpoint
dashboardRouter.get('/:tenantId/events/stream', requirePermission('dashboard:read'),
  (req: Request, res: Response): void => {
    const tenantId = req.params['tenantId'] as string;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Register client
    registerClient(tenantId, res);

    // Send initial heartbeat
    res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);

    // Heartbeat every 30 seconds
    const heartbeatInterval = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      } catch {
        clearInterval(heartbeatInterval);
        unregisterClient(tenantId, res);
      }
    }, 30000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      unregisterClient(tenantId, res);
    });
  });
