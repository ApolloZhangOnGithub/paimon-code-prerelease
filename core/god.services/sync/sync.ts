import { Hono } from "hono";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { stmt } from "./db.ts";
import type { AuthUser } from "./auth.ts";

const STORAGE_DIR = process.env.SYNC_STORAGE_DIR || "./storage";

function storagePath(githubId: number, filePath: string): string {
  return join(STORAGE_DIR, String(githubId), filePath);
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export const syncRouter = new Hono();

syncRouter.get("/manifest", (c) => {
  const user = c.get("user") as AuthUser;
  const rows = stmt.getManifest.all(user.githubId) as Array<{
    path: string; hash: string; size: number; version: number; updated_at: string;
  }>;
  const files: Record<string, { hash: string; size: number; version: number; updatedAt: string }> = {};
  for (const r of rows) {
    files[r.path] = { hash: r.hash, size: r.size, version: r.version, updatedAt: r.updated_at };
  }
  return c.json({ files });
});

syncRouter.post("/push", async (c) => {
  const user = c.get("user") as AuthUser;
  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const form = await c.req.formData();
    const results: Array<{ path: string; version: number; ok: boolean; error?: string }> = [];

    for (const [filePath, value] of form.entries()) {
      if (typeof value === "string") continue;
      const file = value as File;
      const buf = Buffer.from(await file.arrayBuffer());
      const hash = sha256(buf);
      const dst = storagePath(user.githubId, filePath);
      mkdirSync(dirname(dst), { recursive: true });
      writeFileSync(dst, buf);
      stmt.upsertFile.run(user.githubId, filePath, hash, buf.length);
      const row = stmt.getManifest.all(user.githubId).find((r: any) => r.path === filePath) as any;
      results.push({ path: filePath, version: row?.version || 1, ok: true });
    }

    return c.json({ results });
  }

  const { path: filePath, content } = await c.req.json<{ path: string; content: string }>();
  if (!filePath || content === undefined) return c.json({ error: "path and content required" }, 400);

  const buf = Buffer.from(content, "base64");
  const hash = sha256(buf);
  const dst = storagePath(user.githubId, filePath);
  mkdirSync(dirname(dst), { recursive: true });
  writeFileSync(dst, buf);
  stmt.upsertFile.run(user.githubId, filePath, hash, buf.length);

  const row = stmt.getManifest.all(user.githubId).find((r: any) => r.path === filePath) as any;
  return c.json({ path: filePath, version: row?.version || 1, hash, ok: true });
});

syncRouter.post("/pull", async (c) => {
  const user = c.get("user") as AuthUser;
  const { paths } = await c.req.json<{ paths: string[] }>();
  if (!paths?.length) return c.json({ error: "paths required" }, 400);

  const results: Array<{ path: string; content: string; hash: string; size: number } | { path: string; error: string }> = [];
  for (const p of paths) {
    const fp = storagePath(user.githubId, p);
    if (!existsSync(fp)) {
      results.push({ path: p, error: "not found" });
      continue;
    }
    const buf = readFileSync(fp);
    results.push({ path: p, content: buf.toString("base64"), hash: sha256(buf), size: buf.length });
  }
  return c.json({ results });
});

syncRouter.post("/lock/:personId", (c) => {
  const user = c.get("user") as AuthUser;
  const personId = c.req.param("personId");

  stmt.expireLocks.run();

  const existing = stmt.getLock.get(user.githubId, personId) as any;
  if (existing && existing.device_id !== user.deviceId) {
    const hb = new Date(existing.heartbeat + "Z").getTime();
    if (Date.now() - hb < 5 * 60 * 1000) {
      return c.json({
        error: "locked",
        holder: { deviceId: existing.device_id, since: existing.acquired_at },
      }, 409);
    }
  }

  stmt.acquireLock.run(user.githubId, personId, user.deviceId);
  const lock = stmt.getLock.get(user.githubId, personId) as any;
  if (lock && lock.device_id !== user.deviceId) {
    return c.json({
      error: "locked",
      holder: { deviceId: lock.device_id, since: lock.acquired_at },
    }, 409);
  }
  return c.json({ ok: true, personId });
});

syncRouter.post("/lock/:personId/heartbeat", (c) => {
  const user = c.get("user") as AuthUser;
  const personId = c.req.param("personId");
  stmt.heartbeatLock.run(user.githubId, personId, user.deviceId);
  const hbLock = stmt.getLock.get(user.githubId, personId) as any;
  if (!hbLock || hbLock.device_id !== user.deviceId) return c.json({ error: "lock not held" }, 404);
  return c.json({ ok: true });
});

syncRouter.delete("/lock/:personId", (c) => {
  const user = c.get("user") as AuthUser;
  const personId = c.req.param("personId");
  stmt.releaseLock.run(user.githubId, personId, user.deviceId);
  return c.json({ ok: true });
});
