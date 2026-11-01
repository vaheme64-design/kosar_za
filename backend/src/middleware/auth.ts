import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { db } from '../config/db';
import { env } from '../config/env';

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: { id: string; name: string; nameFa: string };
  permissions: string[];
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const unauthorized = (fa: string) =>
  ({ error: 'unauthorized', message: fa, messageFa: fa });

/** Verify the Bearer JWT and attach the fresh user profile (with permissions). */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json(unauthorized('ابتدا وارد سامانه شوید'));
    return;
  }
  const token = header.slice('Bearer '.length).trim();

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { sub?: string };
    if (!payload.sub) throw new Error('bad payload');

    const user = await db.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });
    if (!user || !user.isActive || !user.role.isActive) {
      res.status(401).json(unauthorized('حساب کاربری معتبر نیست یا غیرفعال شده است'));
      return;
    }

    req.user = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: { id: user.role.id, name: user.role.name, nameFa: user.role.nameFa },
      permissions: user.role.rolePermissions.map((rp) => rp.permission.code),
    };
    next();
  } catch {
    res.status(401).json(unauthorized('توکن نامعتبر یا منقضی شده است'));
  }
}

/** RBAC guard — check a single permission code, e.g. requirePermission('inventory.post'). */
export function requirePermission(code: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json(unauthorized('ابتدا وارد سامانه شوید'));
      return;
    }
    if (!req.user.permissions.includes(code)) {
      res.status(403).json({
        error: 'forbidden',
        message: `Missing permission: ${code}`,
        messageFa: 'شما مجوز لازم برای این عملیات را ندارید',
        requiredPermission: code,
      });
      return;
    }
    next();
  };
}
