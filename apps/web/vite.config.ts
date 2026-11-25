import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    ...(mode === "android"
      ? [
          {
            name: "android-phone-policy",
            transformIndexHtml() {
              return [
                {
                  tag: "meta",
                  attrs: {
                    "http-equiv": "Content-Security-Policy",
                    content:
                      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",
                  },
                  injectTo: "head-prepend" as const,
                },
              ];
            },
          },
        ]
      : []),
  ],
  server: { proxy: { "/api": { target: "http://127.0.0.1:8000", ws: true } } },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
}));
