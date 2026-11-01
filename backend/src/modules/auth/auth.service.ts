import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { User, Role, Permission } from '@prisma/client';
import { db } from '../../config/db';
import { env } from '../../config/env';
import { ApiError } from '../../lib/http';
import { recordAudit } from '../../lib/audit';

type UserWithRole = User & {
  role: Role & { rolePermissions: { permission: Permission }[] };
};

export interface LoginMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface UserProfile {
  id: string;
  username: string;
  fullName: string;
  role: { id: string; name: string; nameFa: string };
  permissions: string[];
}

/** Constant-time-ish guard: compare against a throwaway hash when user is missing. */
const DUMMY_HASH = bcrypt.hashSync('kpims-dummy-password', 10);

function toProfile(user: UserWithRole): UserProfile {
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: { id: user.role.id, name: user.role.name, nameFa: user.role.nameFa },
    permissions: user.role.rolePermissions.map((rp) => rp.permission.code),
  };
}

function signAccessToken(user: UserWithRole): string {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role.name },
    env.JWT_SECRET,
    { expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] },
  );
}

export async function login(input: { username: string; password: string }, meta: LoginMeta) {
  const user = await db.user.findUnique({
    where: { username: input.username },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });

  const passwordOk = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !passwordOk) {
    await recordAudit(null, {
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user?.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    throw new ApiError(401, 'Invalid username or password', 'نام کاربری یا گذرواژه نادرست است', 'invalid_credentials');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'This account is deactivated', 'حساب کاربری شما غیرفعال است', 'account_disabled');
  }

  const token = signAccessToken(user);

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await recordAudit(null, {
    userId: user.id,
    action: 'LOGIN',
    entityType: 'User',
    entityId: user.id,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return {
    token,
    tokenType: 'Bearer' as const,
    expiresIn: env.JWT_ACCESS_TTL,
    user: toProfile(user),
  };
}

export async function getProfile(userId: string): Promise<UserProfile> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });
  if (!user || !user.isActive) {
    throw new ApiError(401, 'User not found or inactive', 'کاربر یافت نشد یا غیرفعال است', 'unauthorized');
  }
  return toProfile(user);
}
