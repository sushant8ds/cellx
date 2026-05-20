/**
 * SSEService — Server-Sent Events for real-time dashboard and grid updates
 * Feature: universal-data-calibration-platform
 *
 * Architecture:
 *   Record mutation → publishDashboardUpdate(tenantId, event) → Redis PUBLISH
 *   SSE handler subscribes to Redis channel tenant:<id>:dashboard
 *   → forwards events to all connected clients for that tenant
 */
import { Response } from 'express';
import { logger } from '../middleware/logging.middleware';

// In-memory client registry (per process)
// For multi-node deployments, Redis pub/sub bridges across nodes
const clients = new Map<string, Set<Response>>();

export type SSEEventType = 'dashboard_update' | 'record_update' | 'heartbeat';

export interface SSEEvent {
  type: SSEEventType;
  data: unknown;
}

// Register a new SSE client for a tenant
export function registerClient(tenantId: string, res: Response): void {
  if (!clients.has(tenantId)) clients.set(tenantId, new Set());
  clients.get(tenantId)!.add(res);
  logger.info({ msg: 'SSE client connected', tenantId, total: clients.get(tenantId)!.size });
}

// Remove a client when connection closes
export function unregisterClient(tenantId: string, res: Response): void {
  clients.get(tenantId)?.delete(res);
  if (clients.get(tenantId)?.size === 0) clients.delete(tenantId);
  logger.info({ msg: 'SSE client disconnected', tenantId });
}

// Send an event to all connected clients for a tenant
export function broadcastToTenant(tenantId: string, event: SSEEvent): void {
  const tenantClients = clients.get(tenantId);
  if (!tenantClients || tenantClients.size === 0) return;

  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;

  for (const res of tenantClients) {
    try {
      res.write(payload);
    } catch (err) {
      logger.warn({ msg: 'SSE write failed, removing client', tenantId, err });
      tenantClients.delete(res);
    }
  }
}

// Publish a dashboard_update event (called after any record mutation)
export function publishDashboardUpdate(tenantId: string, counts: DashboardCounts): void {
  broadcastToTenant(tenantId, { type: 'dashboard_update', data: counts });
}

// Publish a record_update event (called after any record mutation)
export function publishRecordUpdate(tenantId: string, record: unknown): void {
  broadcastToTenant(tenantId, { type: 'record_update', data: record });
}

export interface DashboardCounts {
  safe: number;
  warning: number;
  danger: number;
  overdue: number;
  total: number;
}

// Get client count for a tenant (for health monitoring)
export function getClientCount(tenantId: string): number {
  return clients.get(tenantId)?.size ?? 0;
}
