import { afterEach, describe, expect, it, vi } from "vitest";
import { authApi } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("session revalidation", () => {
  it("keeps a reverse proxy challenge distinct from an ended session", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<p>Reverse proxy login</p>", {
          status: 401,
          headers: { "Content-Type": "text/html" },
        }),
    );
    await expect(authApi.getSession()).rejects.toMatchObject({ status: 401 });
  });

  it("recognizes the Noted session rejection", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ detail: "Sign in to continue" }, { status: 401 }),
    );
    await expect(authApi.getSession()).resolves.toBeNull();
  });
});
