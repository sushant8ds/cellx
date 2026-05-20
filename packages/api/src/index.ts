import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { initTelemetry, httpLogger, traceMiddleware } from './middleware/logging.middleware';
// Initialize OpenTelemetry before anything else
initTelemetry();

import express, { Request, Response, NextFunction } from 'express';
import { authRouter } from './auth/auth.router';
import { ssoRouter } from './auth/sso.router';
import { signupRouter } from './auth/signup.router';
import { apiKeyRouter } from './auth/api-key.router';
import { usersRouter } from './auth/users.router';
import { tenantRouter } from './tenant/tenant.router';
import { platformRouter } from './platform/platform.router';
import { schemaRouter } from './schema/schema.router';
import { recordRouter } from './records/record.router';
import { auditRouter } from './audit/audit.router';
import { formulaRouter } from './formula/formula.router';
import { alertRouter } from './alerts/alert.router';
import { importRouter } from './import/import.router';
import { exportRouter } from './export/export.router';
import { dashboardRouter } from './dashboard/dashboard.router';
import { aiRouter } from './ai/ai.router';
import { solverRouter } from './solver/solver.router';
import { pool } from './db/pool';


const app = express();

// CORS — allow frontend dev server and any configured origin
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3001').split(',');
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Trace-Id');
  res.setHeader('Access-Control-Expose-Headers', 'X-Session-Id,X-Job-Id,X-Trace-Id');
  if (req.method === 'OPTIONS') { res.status(204).send(); return; }
  next();
});

app.use(express.json());
app.use(traceMiddleware);
app.use(httpLogger);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global middleware: reject requests from suspended tenants (deleted_at IS NOT NULL)
// Runs after auth has populated req.user
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!req.user || req.user.isSuperadmin) {
    next();
    return;
  }
  try {
    const result = await pool.query(
      'SELECT deleted_at FROM tenants WHERE id = $1',
      [req.user.tenantId],
    );
    if (result.rows.length > 0 && result.rows[0].deleted_at !== null) {
      res.status(403).json({ error: 'Tenant suspended' });
      return;
    }
  } catch {
    // If we can't check, let the request through — don't block on DB errors here
  }
  next();
});

app.use('/auth/sso', ssoRouter);
app.use('/auth', signupRouter);
app.use('/auth', authRouter);
app.use('/tenants', apiKeyRouter);
app.use('/tenants', usersRouter);
app.use('/tenants', tenantRouter);
app.use('/tenants', schemaRouter);
app.use('/tenants', recordRouter);
app.use('/tenants', auditRouter);
app.use('/tenants', formulaRouter);
app.use('/tenants', alertRouter);
app.use('/tenants', importRouter);
app.use('/tenants', exportRouter);
app.use('/tenants', dashboardRouter);
app.use('/tenants', aiRouter);
app.use('/tenants', solverRouter);
app.use('/', platformRouter);

const port = process.env.PORT ?? 3000;
app.listen(port, () => {
  console.log(`API listening on port ${port}`);
});

export { app };
export default app;
