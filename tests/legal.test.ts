import type { Express, Request, Response } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerLegalRoutes } from "../server/_core/legal";

type Handler = (request: Request, response: Response) => void;

function createResponse() {
  const state: { statusCode: number; headers: Record<string, string>; contentType: string; body: string } = {
    statusCode: 200,
    headers: {},
    contentType: "",
    body: "",
  };
  const response = {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    set(name: string, value: string) {
      state.headers[name] = value;
      return this;
    },
    type(value: string) {
      state.contentType = value;
      return this;
    },
    send(value: string) {
      state.body = value;
      return this;
    },
  };
  return { state, response: response as unknown as Response };
}

function getHandler(path: string) {
  const handlers = new Map<string, Handler>();
  const app = {
    get(route: string, handler: Handler) {
      handlers.set(route, handler);
      return this;
    },
  } as unknown as Express;
  registerLegalRoutes(app);
  const handler = handlers.get(path);
  if (!handler) throw new Error(`Legal route was not registered: ${path}`);
  return handler;
}

afterEach(() => vi.unstubAllEnvs());

describe("public legal routes", () => {
  it("publishes the privacy policy with escaped operator contact only after values are set", () => {
    vi.stubEnv("MACHIARU_OPERATOR_NAME", "Machiaru <運営>");
    vi.stubEnv("MACHIARU_SUPPORT_EMAIL", "support@example.jp");
    const handler = getHandler("/api/legal/privacy");
    const { state, response } = createResponse();

    handler({} as Request, response);

    expect(state.statusCode).toBe(200);
    expect(state.contentType).toBe("html");
    expect(state.headers["Cache-Control"]).toBe("no-store");
    expect(state.body).toContain("Machiaru &lt;運営&gt;");
    expect(state.body).toContain('href="mailto:support@example.jp"');
    expect(state.body).toContain("位置");
    expect(state.body).toContain("削除");
  });

  it("publishes an App Store support page with the contact email", () => {
    vi.stubEnv("MACHIARU_OPERATOR_NAME", "Machiaru");
    vi.stubEnv("MACHIARU_SUPPORT_EMAIL", "support@example.jp");
    const handler = getHandler("/api/legal/support");
    const { state, response } = createResponse();

    handler({} as Request, response);

    expect(state.statusCode).toBe(200);
    expect(state.body).toContain("お問い合わせ・サポート");
    expect(state.body).toContain("コミュニティルール");
    expect(state.body).toContain("support@example.jp");
  });

  it("does not publish either page with placeholder contact values", () => {
    vi.stubEnv("MACHIARU_OPERATOR_NAME", "");
    vi.stubEnv("EXPO_PUBLIC_OPERATOR_NAME", "");
    vi.stubEnv("MACHIARU_SUPPORT_EMAIL", "");
    vi.stubEnv("EXPO_PUBLIC_SUPPORT_EMAIL", "");
    const handler = getHandler("/api/legal/privacy");
    const { state, response } = createResponse();

    handler({} as Request, response);

    expect(state.statusCode).toBe(503);
    expect(state.headers["Cache-Control"]).toBe("no-store");
    expect(state.body).toContain("公開準備中");
    expect(state.body).not.toContain("support@example.jp");
  });
});
