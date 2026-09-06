import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodePrivateKey, signApiRequest } from "../../../server/utils/nobitex";

describe("Nobitex Ed25519 signing", () => {
  it("signs the exact timestamp + method + full path + body payload", () => {
    const pair = generateKeyPairSync("ed25519");
    const pkcs8 = pair.privateKey.export({ format: "der", type: "pkcs8" });
    const seed = pkcs8.subarray(-32);
    const privateKey = seed.toString("base64url");
    const timestamp = "1788716400";
    const method = "POST" as const;
    const fullPath = "/market/orders/add";
    const body = '{"type":"buy","srcCurrency":"btc","dstCurrency":"rls","amount":"0.001","execution":"market"}';

    const encoded = signApiRequest(privateKey, timestamp, method, fullPath, body);
    const signature = Buffer.from(encoded.replace(/-/g, "+").replace(/_/g, "/"), "base64");

    expect(verify(null, Buffer.from(`${timestamp}${method}${fullPath}${body}`), pair.publicKey, signature)).toBe(true);
    expect(decodePrivateKey(privateKey)).toEqual(seed);
  });

  it("rejects legacy non-Ed25519 secrets", () => {
    expect(() => decodePrivateKey("old-hmac-secret")).toThrow(/Ed25519/);
  });
});
