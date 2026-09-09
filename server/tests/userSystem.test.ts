import { describe, expect, it, beforeEach } from "vitest";
import jwt from "jsonwebtoken";
import { db } from "../src/db.js";
import { ApiError } from "../src/errors.js";
import {
  changePassword,
  identify,
  login,
  register,
  removeUser,
} from "../src/modules/userSystem.js";
import { advanceCycle } from "../src/modules/stateMachine.js";
import { truncateAll } from "./helpers.js";

const USERNAME = "alice";
const PASSWORD = "secret123";

async function registerAlice(): Promise<number> {
  const user = await register(USERNAME, PASSWORD);
  return user.id;
}

describe("register", () => {
  beforeEach(truncateAll);

  it("creates a user with a hashed password", async () => {
    const user = await register("bob", "hunter222");
    const row = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row.passwordHash).not.toContain("hunter222");
    expect(row.passwordHash).toMatch(/^\$2/); // bcrypt hash
  });

  it("rejects a duplicate username", async () => {
    await registerAlice();
    await expect(register(USERNAME, PASSWORD)).rejects.toMatchObject({
      status: 409,
      code: "USERNAME_TAKEN",
    });
  });

  it("rejects malformed usernames and passwords", async () => {
    await expect(register("with space", PASSWORD)).rejects.toMatchObject({ status: 400 });
    await expect(register("a".repeat(33), PASSWORD)).rejects.toMatchObject({ status: 400 });
    await expect(register("bob", "")).rejects.toMatchObject({ status: 400 });
    await expect(register("bob", "12345")).rejects.toMatchObject({ status: 400 });
  });
});

describe("login and identify", () => {
  beforeEach(truncateAll);

  it("logs in with correct credentials only", async () => {
    await registerAlice();
    await expect(login(USERNAME, "wrong-password")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    await expect(login("nobody", PASSWORD)).rejects.toMatchObject({ status: 401 });
    await expect(login(USERNAME, PASSWORD)).resolves.toBeTypeOf("string");
  });

  it("identify resolves a valid token to the user", async () => {
    const userId = await registerAlice();
    const token = await login(USERNAME, PASSWORD);
    const user = await identify(token);
    expect(user.id).toBe(userId);
    expect(user.username).toBe(USERNAME);
    expect(user.createdAt).toBeInstanceOf(Date);
  });

  it("rejects a tampered token", async () => {
    await registerAlice();
    const token = jwt.sign({ username: USERNAME }, "not-the-secret", { subject: String(1) });
    await expect(identify(token)).rejects.toMatchObject({ status: 401, code: "INVALID_TOKEN" });
  });

  it("rejects a token of a removed user", async () => {
    const userId = await registerAlice();
    const token = await login(USERNAME, PASSWORD);
    await removeUser(userId);
    await expect(identify(token)).rejects.toMatchObject({ status: 401, code: "INVALID_TOKEN" });
  });
});

describe("changePassword and removeUser", () => {
  beforeEach(truncateAll);

  it("changePassword requires the old password", async () => {
    const userId = await registerAlice();
    await expect(changePassword(userId, "wrong", "newpass456")).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
    });
    await changePassword(userId, PASSWORD, "newpass456");
    await expect(login(USERNAME, PASSWORD)).rejects.toMatchObject({ status: 401 });
    await expect(login(USERNAME, "newpass456")).resolves.toBeTypeOf("string");
  });

  it("removeUser deletes the account with its products, states, records and imports", async () => {
    const userId = await registerAlice();
    const scope = { userId, productType: "widget" };
    await db.product.create({ data: scope });
    await db.importedSale.create({ data: { ...scope, date: new Date(2026, 7, 1), amount: 9 } });
    await advanceCycle(scope, { sent: 0, received: 0, sale: 10, purchase: 10 });
    await db.scopeRecord.create({ data: { ...scope, kind: "SELL", amount: 5 } });

    await removeUser(userId);

    expect(await db.user.count()).toBe(0);
    expect(await db.product.count()).toBe(0);
    expect(await db.importedSale.count()).toBe(0);
    expect(await db.cycleState.count()).toBe(0);
    expect(await db.scopeRecord.count()).toBe(0);
  });
});

describe("api errors", () => {
  it("ApiError carries status and code", () => {
    const error = new ApiError(418, "TEAPOT", "short and stout");
    expect(error.status).toBe(418);
    expect(error.code).toBe("TEAPOT");
    expect(error.message).toBe("short and stout");
    expect(error).toBeInstanceOf(Error);
  });
});
