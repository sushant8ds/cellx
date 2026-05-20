import { Request, Response, NextFunction } from 'express';

export type Action =
  | 'schema:write'
  | 'schema:read'
  | 'records:write'
  | 'records:read'
  | 'records:bulk'
  | 'formulas:write'
  | 'alerts:write'
  | 'alerts:trigger'
  | 'audit:read'
  | 'import'
  | 'export'
  | 'api-keys:manage'
  | 'users:manage'
  | 'billing'
  | 'dashboard:read';

export const ALL_ACTIONS: Action[] = [
  'schema:write',
  'schema:read',
  'records:write',
  'records:read',
  'records:bulk',
  'formulas:write',
  'alerts:write',
  'alerts:trigger',
  'audit:read',
  'import',
  'export',
  'api-keys:manage',
  'users:manage',
  'billing',
  'dashboard:read',
];

export const PERMISSION_MATRIX: Record<string, Action[]> = {
  admin: [...ALL_ACTIONS],
  manager: [
    'records:write',
    'records:read',
    'records:bulk',
    'alerts:trigger',
    'audit:read',
    'import',
    'export',
    'dashboard:read',
  ],
  operator: ['records:read', 'dashboard:read'],
};

export function isActionAllowed(role: string, action: Action): boolean {
  const allowed = PERMISSION_MATRIX[role];
  if (!allowed) return false;
  return allowed.includes(action);
}

export function requirePermission(action: Action) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (req.user.isSuperadmin || isActionAllowed(req.user.role, action)) {
      next();
      return;
    }

    res.status(403).json({ error: 'Forbidden', required: action });
  };
}

export function SuperadminMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.user.isSuperadmin) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}
