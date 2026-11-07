import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { sqlOne } from "./db";

const COOKIE_NAME = "spinlytics_session";

export type SessionUser = {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  subscription_status: string;
  plan_id: string | null;
  plan_expire_at: string | null;
  telegram_chat_id: string | null;
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
    .setExpirationTime("7d")
    .sign(secretKey());
}

export async function verifySessionToken(
  token: string,
): Promise<{ sub: string; email: string; role: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (!payload.sub || typeof payload.email !== "string") return null;
    return {
      sub: payload.sub,
      email: payload.email,
      role: String(payload.role || "USER"),
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
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE_NAME);
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
            plan_expire_at::text, telegram_chat_id
     FROM users WHERE id = $1`,
    [payload.sub],
  );
  return user;
}

export async function requireUser(req?: NextRequest): Promise<SessionUser> {
  const user = await getCurrentUser(req);
  if (!user) {
    throw new AuthError("Unauthorized", 401);
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

export { COOKIE_NAME };
