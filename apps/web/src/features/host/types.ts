export interface HostJob {
  id: string;
  action: "probe" | "transfer" | "domain" | "remove" | "cancel";
  status:
    "queued" | "running" | "waiting_dns" | "succeeded" | "failed" | "needs_recovery" | "cancelled";
  phase: string;
  detail: string;
  destination: string | null;
  ip: string | null;
  fingerprint: string | null;
  host_key: string | null;
}

export interface HostStatus {
  configured: boolean;
  worker_online: boolean;
  capable: boolean;
  instance_id: string;
  job: HostJob | null;
}

export interface TransferRequest {
  ip: string;
  port: number;
  ssh_user: "root";
  ssh_password: string;
  host_key: string;
  owner_username: string;
  owner_password: string;
  current_password: string;
  pause_confirmed: true;
}
