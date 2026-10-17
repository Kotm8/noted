export interface User {
  id: string;
  username: string;
}

export interface Credentials {
  username: string;
  password: string;
}

export interface SetupStatus {
  setup_required: boolean;
}

export interface LoginSession {
  id: string;
  created_at: string | null;
  last_seen_at: string | null;
  expires_at: string;
  user_agent: string | null;
  is_current: boolean;
}
