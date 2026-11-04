/**
 * اعتبارنامهٔ Basic برای routeهای حساس: فقط در sessionStorage همین تب نگه داشته می‌شود
 * و به‌صورت خودکار به درخواست‌های هم‌مسیرِ `/api/` اضافه می‌گردد.
 */
const STORAGE_KEY = "tradeban_basic_auth";

export const AUTH_REQUIRED_EVENT = "tradeban:auth-required";

export function getBasicAuthHeader(): string | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    return stored ? `Basic ${stored}` : null;
  } catch {
    return null;
  }
}

export function hasStoredCredentials(): boolean {
  try {
    return Boolean(sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export function setBasicAuthCredentials(user: string, password: string): void {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  sessionStorage.setItem(STORAGE_KEY, btoa(binary));
}

export function clearBasicAuthCredentials(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // sessionStorage در دسترس نیست
  }
}

function isSameOriginApi(input: RequestInfo | URL): boolean {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return url.startsWith("/api/") || url.startsWith(`${window.location.origin}/api/`);
}

/** پوشش سراسری fetch: چسباندن اعتبارنامه به درخواست‌های حساس + اعلام 401 به رابط کاربری */
export function installBasicAuthFetch(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let nextInit = init;
    if (isSameOriginApi(input)) {
      const auth = getBasicAuthHeader();
      if (auth) {
        const headers = new Headers(init?.headers);
        if (!headers.has("Authorization")) headers.set("Authorization", auth);
        nextInit = { ...init, headers };
      }
    }
    const response = await original(input, nextInit);
    if (isSameOriginApi(input) && response.status === 401) {
      window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
    }
    return response;
  };
}
