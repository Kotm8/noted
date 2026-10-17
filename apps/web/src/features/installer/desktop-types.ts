export interface HostIdentity {
  hostKey: string;
  fingerprint: string;
}

export interface ServerRelease {
  version: string;
  commit: string;
  manifestSha256: string;
}

export interface InstallationPlan {
  host: { ip: string; port: number };
  hostKey: string;
  serverName: string;
  domain: string;
  username: string;
  repository: string;
  releaseCommit: string;
  manifestSha256: string;
}

export interface InstallationJob {
  status: "" | "running" | "waiting_dns" | "complete" | "failed";
  phase: string;
  detail: string;
  plan: InstallationPlan | null;
}
