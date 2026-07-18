import { Hono } from "hono";
import { cors } from "hono/cors";
import { authRouter, authMiddleware, resolveUser } from "./auth.ts";
import { syncRouter } from "./sync.ts";
import { messagingRouter, registerWs, routeMessage } from "./messaging.ts";
import { stmt } from "./db.ts";

const app = new Hono();

app.use("*", cors());
app.route("/auth", authRouter);

app.use("/sync/*", authMiddleware());
app.route("/sync", syncRouter);

app.use("/messages/*", authMiddleware());
app.route("/messages", messagingRouter);

app.get("/health", (c) => c.json({ status: "ok", ts: new Date().toISOString() }));

app.get("/auth/wiki-verify", async (c) => {
  const token = c.req.header("X-Paimon-Token") || c.req.query("token") || "";
  if (!token) return c.text("denied", 403);

  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "paimon-sync" },
  });
  if (!res.ok) return c.text("denied", 403);
  return c.text("ok", 200);
});

app.get("/auth/wiki-cookie", async (c) => {
  const token = c.req.query("token") || "";
  if (!token) return c.text("missing token", 403);

  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "paimon-sync" },
  });
  if (!res.ok) return c.text("invalid token", 403);

  c.header("Set-Cookie", `paimon_token=${token}; Path=/; Max-Age=86400; Secure; HttpOnly; SameSite=Lax`);
  return c.redirect("/");
});

setInterval(() => {
  stmt.expireLocks.run();
  stmt.expireMessages.run();
}, 60_000);

const port = parseInt(process.env.PORT || "3456");

const server = Bun.serve({
  port,
  fetch: app.fetch,
  websocket: {
    async open(ws) {
      const url = new URL(ws.data.url);
      const token = url.searchParams.get("token");
      const deviceId = url.searchParams.get("deviceId");
      const personId = url.searchParams.get("personId");

      if (!token || !deviceId || !personId) {
        ws.close(4001, "missing params");
        return;
      }

      const user = await resolveUser(token, deviceId);
      if (!user) { ws.close(4001, "unauthorized"); return; }

      (ws as any)._paimon = { githubId: user.githubId, personId, deviceId };
      (ws as any)._cleanup = registerWs(user.githubId, personId, ws);

      const pending = stmt.pullMessages.all(user.githubId, personId) as any[];
      for (const r of pending) {
        ws.send(JSON.stringify({
          fromPerson: r.from_person, fromDevice: r.from_device,
          type: r.type, payload: JSON.parse(r.payload), ts: r.created_at,
        }));
        stmt.markDelivered.run(r.id);
      }
    },

    message(ws, raw) {
      const ctx = (ws as any)._paimon;
      if (!ctx) return;

      try {
        const msg = JSON.parse(String(raw));
        if (msg.to && msg.payload !== undefined) {
          const full = {
            fromPerson: ctx.personId,
            fromDevice: ctx.deviceId,
            ...msg,
            ts: new Date().toISOString(),
          };
          const delivered = routeMessage(ctx.githubId, msg.to, full);
          if (!delivered) {
            stmt.pushMessage.run(
              ctx.githubId, ctx.personId, ctx.deviceId, msg.to,
              msg.type || "text", JSON.stringify(msg.payload),
            );
          }
          ws.send(JSON.stringify({ ack: true, delivered }));
        }
      } catch {}
    },

    close(ws) {
      (ws as any)._cleanup?.();
    },
  },
});

console.log(`paimon sync server listening on :${port}`);
