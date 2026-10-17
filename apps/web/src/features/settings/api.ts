import { request } from "../../lib/http";
import type { User } from "../auth/types";
import type { AppearancePreferences } from "./appearance";

export interface ServerSettings {
  server_name: string;
  instance_url: string;
  version: string;
  api_version: number;
  schema_revision: string | null;
  database_ready: boolean;
  access_mode: string;
  owner_username: string;
}

export const settingsApi = {
  getAppearance(): Promise<AppearancePreferences | null> {
    return request<AppearancePreferences | null>("/settings/appearance");
  },
  saveAppearance(changes: Partial<AppearancePreferences>, initialize = false): Promise<AppearancePreferences> {
    return request<AppearancePreferences>(`/settings/appearance?initialize=${initialize}`, "PUT", changes);
  },
  getServer(): Promise<ServerSettings> {
    return request<ServerSettings>("/settings/server");
  },
  changePassword(current_password: string, new_password: string): Promise<User> {
    return request<User>("/settings/password", "PUT", { current_password, new_password });
  },
};
