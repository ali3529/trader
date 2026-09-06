import { defineHandler } from "nitro";
import { createError } from "nitro/h3";
import { loadKeys, NobitexRequestError, privateRequest } from "../../../utils/nobitex";
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

/**
 * Returns only the short-lived WebSocket credential and channel suffix needed
 * by the browser. The API private key never leaves the server.
 */
export default defineHandler(async (event) => {
  assertSensitiveRequest(event);
  const keys = loadKeys();
  const wsUrl = keys?.sandbox
    ? "wss://testnetws.nobitex.ir/connection/websocket"
    : "wss://ws.nobitex.ir/connection/websocket";

  if (!keys) {
    return { wsUrl, privateEnabled: false, token: null, websocketAuthParam: null, user: null };
  }

  try {
    const [profileResponse, tokenResponse] = await Promise.all([
      privateRequest("GET", "/users/profile"),
      privateRequest("GET", "/auth/ws/token/"),
    ]) as [ProfileResponse, TokenResponse];
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
      user: {
        displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null,
        username: profile.username ?? profile.email ?? null,
      },
    };
  } catch (error) {
    throw createError({
      statusCode: error instanceof NobitexRequestError ? error.statusCode : 502,
      statusMessage: `اتصال خصوصی نوبیتکس ناموفق بود: ${(error as Error).message}`,
    });
  }
});
