import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
});

export const httpLogger = pinoHttp({
  logger,
  genReqId: () => randomUUID(),
  customProps: (req: Request, res: Response) => ({
    trace_id: (req as Request & { traceId?: string }).traceId,
    tenant_id: req.user?.tenantId,
    user_id: req.user?.userId,
  }),
  customSuccessMessage: (req, res) =>
    `${req.method} ${req.url} ${res.statusCode}`,
  customErrorMessage: (req, res, err) =>
    `${req.method} ${req.url} ${res.statusCode} - ${err.message}`,
  // Attach trace_id to request and response headers
  customReceivedMessage: (req) => {
    const traceId = randomUUID();
    (req as Request & { traceId?: string }).traceId = traceId;
    (req as Request & { headers: Record<string, string> }).headers['x-trace-id'] = traceId;
    return `incoming request ${req.method} ${req.url}`;
  },
});

// Middleware that attaches trace_id to req and res
export function traceMiddleware(
  req: Request & { traceId?: string },
  res: Response,
  next: () => void,
): void {
  const traceId = (req.headers['x-trace-id'] as string) || randomUUID();
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);
  next();
}

export function initTelemetry(): void {
  if (process.env.OTEL_ENABLED !== 'true') return;

  // Dynamically import to avoid loading OTel when disabled
  import('@opentelemetry/sdk-node').then(({ NodeSDK }) => {
    import('@opentelemetry/auto-instrumentations-node').then(
      ({ getNodeAutoInstrumentations }) => {
        const sdk = new NodeSDK({
          instrumentations: [getNodeAutoInstrumentations()],
        });
        sdk.start();
        logger.info('OpenTelemetry SDK started');
      },
    );
  });
}
