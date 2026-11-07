import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { sqlOne } from "./db";
import { setCsrfCookie, clearCsrfCookie } from "./security/csrf";
import { COOKIE_NAME } from "./session-cookie";

/** Access JWT TTL — short-lived; sliding refresh via /api/auth/me + /api/auth/refresh. */
const ACCESS_TTL = process.env.JWT_ACCESS_TTL?.trim() || "2h";
const ACCESS_MAX_AGE_SEC = Number(process.env.JWT_ACCESS_MAX_AGE_SEC || 2 * 60 * 60);

export type SessionUser = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  subscription_status: string;
  plan_id: string | null;
  plan_expire_at: string | null;
  telegram_chat_id: string | null;
  disabled: boolean;
};

function secretKey() {
  const secret =
    process.env.JWT_SECRET?.trim() || "spinlytics-dev-secret-change-me";
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(user: {
  id: string;
  email: string;
  role: string;
}): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ACCESS_TTL)
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<{ sub: string; email: string; role: string; exp?: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      role: String(payload.role || "USER"),
      exp: typeof payload.exp === "number" ? payload.exp : undefined,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCESS_MAX_AGE_SEC,
  });
  await setCsrfCookie();
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
  await clearCsrfCookie();
}

export async function getTokenFromRequest(
  req?: NextRequest,
): Promise<string | null> {
  if (req) {
    const auth = req.headers.get("authorization");
    if (auth?.startsWith("Bearer ")) return auth.slice(7);
    return req.cookies.get(COOKIE_NAME)?.value ?? null;
  }
  const jar = await cookies();
  return jar.get(COOKIE_NAME)?.value ?? null;
}

export async function getCurrentUser(
  req?: NextRequest,
): Promise<SessionUser | null> {
  const token = await getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  const user = await sqlOne<SessionUser>(
    `SELECT id, email, role, subscription_status, plan_id,
            plan_expire_at::text, telegram_chat_id,
            COALESCE(disabled, FALSE) AS disabled
     FROM users WHERE id = $1`,
    [payload.sub],
  );
  if (!user || user.disabled) return null;
  return user;
}

/** Rotate session cookie when less than 30 minutes remain. */
export async function maybeRefreshSession(
  req?: NextRequest,
): Promise<string | null> {
  const token = await getTokenFromRequest(req);
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload?.exp) return null;
  const remainingSec = payload.exp - Math.floor(Date.now() / 1000);
  if (remainingSec > 30 * 60) return null;

  const user = await getCurrentUser(req);
  if (!user) return null;
  const next = await createSessionToken({
    id: user.id,
    email: user.email,
    role: user.role,
  });
  await setSessionCookie(next);
  return next;
}

export async function requireUser(req?: NextRequest): Promise<SessionUser> {
  const user = await getCurrentUser(req);
  if (!user) {
    throw new AuthError("Unauthorized", 401);
  }
  return user;
}

export async function requireAdmin(req?: NextRequest): Promise<SessionUser> {
  const user = await requireUser(req);
  if (user.role !== "ADMIN") {
    throw new AuthError("Forbidden — admin only", 403);
  }
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export { COOKIE_NAME, ACCESS_TTL, ACCESS_MAX_AGE_SEC };
