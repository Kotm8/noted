import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

declare const jsdom: { window: Window };

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: jsdom.window.localStorage,
});

afterEach(cleanup);
