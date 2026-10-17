import { request } from "../../lib/http";
import type { AvailableRelease, UpdateJob, UpdateStatus } from "./types";

export const updatesApi = {
  status: () => request<UpdateStatus>("/updates/status"),
  check: () => request<void>("/updates/check", "POST"),
  apply: (release: AvailableRelease) =>
    request<UpdateJob>("/updates/apply", "POST", {
      commit: release.commit,
      manifest_sha256: release.manifest_sha256,
    }),
};
