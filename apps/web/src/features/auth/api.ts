import { isSessionRejection, request } from "../../lib/http";
import type { Credentials, LoginSession, SetupStatus, User } from "./types";

export const authApi = {
  getSetupStatus(): Promise<SetupStatus> {
    return request<SetupStatus>(
      "/auth/status",
      "GET",
      undefined,
      AbortSignal.timeout(15000),
    );
  },

  async getSession(): Promise<User | null> {
    try {
      return await request<User>(
        "/auth/session",
        "GET",
        undefined,
        AbortSignal.timeout(15000),
      );
    } catch (error) {
      if (isSessionRejection(error)) {
        return null;
      }

      throw error;
    }
  },

  login(credentials: Credentials): Promise<User> {
    return request<User>("/auth/login", "POST", credentials);
  },

  logout(): Promise<void> {
    return request<void>("/auth/logout", "POST");
  },
  renew(): Promise<void> {
    return request<void>(
      "/auth/renew",
      "POST",
      undefined,
      AbortSignal.timeout(15000),
    );
  },

  listSessions(): Promise<LoginSession[]> {
    return request<LoginSession[]>("/auth/sessions");
  },

  revokeSession(id: string): Promise<void> {
    return request<void>(`/auth/sessions/${id}`, "DELETE");
  },
};
