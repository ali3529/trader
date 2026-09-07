import { createHash, timingSafeEqual } from "node:crypto";
import { createError, getRequestHeader, getRequestURL } from "nitro/h3";

type RequestEvent = Parameters<typeof getRequestURL>[0];

interface SecurityOptions {
  mutation?: boolean;
}

/**
 * Sensitive routes are local-only by default. A remote/production deployment
 * must set TRADEBAN_BASIC_AUTH to `username:strong-password`.
 */
export function assertSensitiveRequest(event: RequestEvent, options: SecurityOptions = {}): void {
  const configuredAuth = String(process.env.TRADEBAN_BASIC_AUTH ?? "").trim();
  if (configuredAuth) {
    verifyBasicAuth(event, configuredAuth);
    verifySameOrigin(event, options.mutation === true);
    return;
  }

  const requestUrl = getRequestURL(event);
  if (!isLoopback(requestUrl.hostname)) {
    throw createError({
      statusCode: 403,
      statusMessage: "دسترسی غیرمحلی بدون TRADEBAN_BASIC_AUTH مجاز نیست",
    });
  }
  if (process.env.NODE_ENV === "production" && process.env.TRADEBAN_ALLOW_LOCAL_UNAUTH !== "true") {
    throw createError({
      statusCode: 503,
      statusMessage: "برای اجرای production باید TRADEBAN_BASIC_AUTH تنظیم شود",
    });
  }
  verifySameOrigin(event, options.mutation === true);
}

function verifyBasicAuth(event: RequestEvent, credentials: string): void {
  if (!credentials.includes(":")) {
    throw createError({ statusCode: 500, statusMessage: "فرمت TRADEBAN_BASIC_AUTH نامعتبر است" });
  }
  const actual = getRequestHeader(event, "authorization") ?? "";
  const expected = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
  if (!secureEqual(actual, expected)) {
    event.res.headers.set("WWW-Authenticate", 'Basic realm="Tradeban", charset="UTF-8"');
    throw createError({ statusCode: 401, statusMessage: "احراز هویت الزامی است" });
  }
}

function verifySameOrigin(event: RequestEvent, mutation: boolean): void {
  if (!mutation) return;
  const fetchSite = (getRequestHeader(event, "sec-fetch-site") ?? "").toLowerCase();
  if (fetchSite === "cross-site") {
    throw createError({ statusCode: 403, statusMessage: "درخواست Cross-Site مجاز نیست" });
  }
  const origin = getRequestHeader(event, "origin");
  if (!origin) return; // permits local CLI/server-to-server operations
  try {
    const requestUrl = getRequestURL(event);
    const originUrl = new URL(origin);
    if (originUrl.host !== requestUrl.host) {
      throw createError({ statusCode: 403, statusMessage: "Origin درخواست معتبر نیست" });
    }
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) throw error;
    throw createError({ statusCode: 403, statusMessage: "Origin درخواست معتبر نیست" });
  }
}

function isLoopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function secureEqual(actual: string, expected: string): boolean {
  const actualHash = createHash("sha256").update(actual).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}
