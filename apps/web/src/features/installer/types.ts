export interface InstallationDraft {
  serverName: string;
  host: string;
  port: string;
  sshUser: string;
  sshPassword: string;
  domain: string;
  /** False when Noted uses an address made from the server IP instead. */
  ownDomain: boolean;
  cloudflare: boolean;
  username: string;
  password: string;
  confirmation: string;
  androidNotifications: boolean;
  googleServicesJson: string;
  serviceAccountJson: string;
}

export type UpdateInstallation = <Key extends keyof InstallationDraft>(
  key: Key,
  value: InstallationDraft[Key],
) => void;

export interface SetupStepProps {
  draft: InstallationDraft;
  update: UpdateInstallation;
}

export const initialInstallation: InstallationDraft = {
  serverName: "",
  host: "",
  port: "22",
  sshUser: "root",
  sshPassword: "",
  domain: "",
  ownDomain: true,
  cloudflare: true,
  username: "",
  password: "",
  confirmation: "",
  androidNotifications: false,
  googleServicesJson: "",
  serviceAccountJson: "",
};
