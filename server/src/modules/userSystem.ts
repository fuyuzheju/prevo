import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { db, type DbClient } from "../db.js";
import { ApiError } from "../errors.js";

export interface AuthUser {
  id: number;
  username: string;
  createdAt: Date;
}

const JWT_EXPIRES_IN = "7d";
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 72; // bcrypt ignores bytes beyond 72

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.warn("[userSystem] JWT_SECRET is not set; using an insecure development secret");
  }
  return secret ?? "dev-only-secret";
}

function assertUsername(username: string): void {
  if (
    typeof username !== "string" ||
    username.length < 1 ||
    username.length > 32 ||
    /\s/.test(username)
  ) {
    throw new ApiError(400, "INVALID_USERNAME", "username must be 1-32 characters without whitespace");
  }
}

function assertPassword(password: string): void {
  if (typeof password !== "string" || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new ApiError(
      400,
      "INVALID_PASSWORD",
      `password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters`,
    );
  }
}

function toAuthUser(user: { id: number; username: string; createdAt: Date }): AuthUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export async function register(
  username: string,
  password: string,
  client: DbClient = db,
): Promise<AuthUser> {
  assertUsername(username);
  assertPassword(password);
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const user = await client.user.create({ data: { username, passwordHash } });
    return toAuthUser(user);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ApiError(409, "USERNAME_TAKEN", "username is already taken");
    }
    throw error;
  }
}

export async function login(
  username: string,
  password: string,
): Promise<string> {
  const user = await db.user.findUnique({ where: { username } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "username or password is wrong");
  }
  return signToken(user.id, user.username);
}

export function signToken(userId: number, username: string): string {
  return jwt.sign({ username }, jwtSecret(), { subject: String(userId), expiresIn: JWT_EXPIRES_IN });
}

// auth & identify: verify a token and return the user it belongs to. Throws
// when the token is invalid or the user no longer exists.
export async function identify(token: string): Promise<AuthUser> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, jwtSecret()) as jwt.JwtPayload;
  } catch {
    throw new ApiError(401, "INVALID_TOKEN", "token is invalid or expired");
  }
  const userId = Number(payload.sub);
  if (!Number.isSafeInteger(userId)) {
    throw new ApiError(401, "INVALID_TOKEN", "token has no valid subject");
  }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(401, "INVALID_TOKEN", "user no longer exists");
  }
  return toAuthUser(user);
}

export async function changePassword(
  userId: number,
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  assertPassword(newPassword);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
    throw new ApiError(401, "INVALID_CREDENTIALS", "old password is wrong");
  }
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.user.update({ where: { id: userId }, data: { passwordHash } });
}

// remove user together with their products, states and records (SQLite does
// not enforce the schema-level cascade without foreign_keys pragma).
export async function removeUser(userId: number): Promise<void> {
  await db.scopeRecord.deleteMany({ where: { userId } });
  await db.cycleState.deleteMany({ where: { userId } });
  await db.product.deleteMany({ where: { userId } });
  await db.user.delete({ where: { id: userId } });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
