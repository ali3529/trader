import { defineHandler } from "nitro";
import { loadKeys, privateRequest, upstreamHealthy } from "../../../utils/nobitex";
import { assertSensitiveRequest } from "../../../utils/requestSecurity";

interface ProfileResponse {
  websocketAuthParam?: string;
  profile?: {
    firstName?: string;
    lastName?: string;
    username?: string;
    email?: string;
    websocketAuthParam?: string;
  };
}

interface TokenResponse {
  token?: string;
}

/** حداکثر بودجهٔ زمانی برای گرفتن اعتبارنامهٔ خصوصی؛ سوکت هرگز نباید معطل این بماند */
const PRIVATE_BUDGET_MS = 8_000;

function withBudget<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("ws-config private budget exceeded")), ms)
    ),
  ]);
}

/**
 * Returns only the short-lived WebSocket credential and channel suffix needed
 * by the browser. The API private key never leaves the server.
 * If Nobitex is unreachable (or slow), we degrade to public-only config so the
 * browser socket can still connect to public market streams immediately.
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  const keys = await loadKeys();
  const wsUrl = keys?.sandbox
    ? "wss://testnetws.nobitex.ir/connection/websocket"
    : "wss://ws.nobitex.ir/connection/websocket";

  const publicOnly = {
    wsUrl,
    privateEnabled: false,
    token: null,
    websocketAuthParam: null,
    user: null,
    degraded: true,
  };

  if (!keys) {
    return { ...publicOnly, degraded: false };
  }
  if (!upstreamHealthy()) {
    console.log("[nobitex] ws-config: circuit open — returning public-only config");
    return publicOnly;
  }

  try {
    const [profileResponse, tokenResponse] = (await withBudget(
      Promise.all([
        privateRequest("GET", "/users/profile"),
        privateRequest("GET", "/auth/ws/token/"),
      ]),
      PRIVATE_BUDGET_MS
    )) as [ProfileResponse, TokenResponse];
    const websocketAuthParam =
      profileResponse.websocketAuthParam ?? profileResponse.profile?.websocketAuthParam;
    if (!tokenResponse.token || !websocketAuthParam) {
      throw new Error("پاسخ نوبیتکس فاقد token یا websocketAuthParam است");
    }
    const profile = profileResponse.profile ?? {};
    return {
      wsUrl,
      privateEnabled: true,
      token: tokenResponse.token,
      websocketAuthParam,
      expiresIn: 1200,
      degraded: false,
      user: {
        displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
        username: profile.username ?? profile.email ?? null,
      },
    };
  } catch (error) {
    console.log(`[nobitex] ws-config degraded to public-only: ${(error as Error).message}`);
    return publicOnly;
  }
});
