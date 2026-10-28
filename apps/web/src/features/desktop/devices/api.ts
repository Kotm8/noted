import { desktopRequest } from "../desktop-request";

export type DeviceKind = "phone" | "watch";

export interface InstallTool {
  ready: boolean;
  source: "downloaded" | "existing" | null;
  path: string | null;
}

export interface Device {
  id: string;
  kind: DeviceKind;
  name: string;
  connection: "usb" | "wifi";
  connected: boolean;
  installed: string | null;
}

export interface DevicesOverview {
  tool: InstallTool;
  serverVersion: string | null;
  devices: Device[];
}

export interface InstallJob {
  deviceId: string;
  status: "idle" | "running" | "done" | "failed";
  stage: "" | "connect" | "download" | "install" | "cleanup";
  progress: number;
  detail: string;
  unreachable: boolean;
  version: string;
}

/** Which release to install from: the wizard's chosen release, or the connected server's. */
export interface ReleaseTarget {
  commit?: string;
  version?: string;
}

export const devicesKey = ["desktop-devices"];

export const devicesApi = {
  overview: () => desktopRequest<DevicesOverview>("devices"),
  downloadTool: () => desktopRequest<InstallTool>("devices/tool", "POST"),
  detectUsb: () =>
    desktopRequest<Device | { waiting: "device" | "unauthorized" }>(
      "devices/usb",
      "POST",
    ),
  pair: (address: string, code: string) =>
    desktopRequest<Device>("devices/pair", "POST", { address, code }),
  reconnect: (id: string) =>
    desktopRequest<Device>("devices/connect", "POST", { id }),
  forget: (id: string) =>
    desktopRequest<void>("devices/forget", "POST", { id }),
  install: (id: string, commit?: string) =>
    desktopRequest<void>("devices/install", "POST", { id, commit }),
  job: () => desktopRequest<InstallJob>("devices/install"),
};
