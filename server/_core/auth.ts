import { ONE_YEAR_MS } from "../../shared/const.js";
import type { Express, Request, Response } from "express";
import { getSessionCookieName, getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function buildUserResponse(user: Awaited<ReturnType<typeof sdk.authenticateRequest>>) {
  return {
    id: user.id,
    openId: user.openId,
    name: user.name,
    email: user.email,
    loginMethod: user.loginMethod,
    lastSignedIn: user.lastSignedIn.toISOString(),
  };
}

/** Register only application-session utilities. This module does not expose a provider login flow. */
export function registerSessionRoutes(app: Express) {
  app.post("/api/auth/logout", (req: Request, res: Response) => {
    res.clearCookie(getSessionCookieName(req), {
      ...getSessionCookieOptions(req),
      maxAge: -1,
    });
    res.json({ success: true });
  });

  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      res.json({ user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Not authenticated", user: null });
    }
  });

  // The email login flow issues a Bearer token; this endpoint establishes the
  // same host-only HttpOnly cookie for embedded HTTPS Preview requests.
  app.post("/api/auth/session", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const authHeader = req.headers.authorization || req.headers.Authorization;
      if (typeof authHeader !== "string" || !authHeader.startsWith("Bearer ")) {
        res.status(400).json({ error: "Bearer token required" });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      res.cookie(getSessionCookieName(req), token, {
        ...getSessionCookieOptions(req),
        maxAge: ONE_YEAR_MS,
      });
      res.json({ success: true, user: buildUserResponse(user) });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });
}
