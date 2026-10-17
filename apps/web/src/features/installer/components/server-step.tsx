import type { SetupStepProps } from "../types";

export function ServerStep({ draft, update, rootOnly = false }: SetupStepProps & { rootOnly?: boolean }) {
  return (
    <section className="installation-step">
      <h1>Your server</h1>
      <p>A name for this installation and the SSH details from your VPS provider.</p>
      <label>
        Server name
        <input
          autoFocus
          aria-label="Server name"
          aria-describedby="server-name-help"
          value={draft.serverName}
          maxLength={80}
          required
          placeholder="My notes"
          onChange={(event) => update("serverName", event.target.value)}
        />
        <small id="server-name-help">Shown in the installer and server settings.</small>
      </label>
      <div className="setup-address-row">
        <label>
          Server IP
          <input
            value={draft.host}
            maxLength={45}
            required
            placeholder="203.0.113.10"
            autoComplete="off"
            onChange={(event) => update("host", event.target.value)}
          />
        </label>
        <label>
          SSH port
          <input
            value={draft.port}
            type="number"
            min={1}
            max={65535}
            required
            onChange={(event) => update("port", event.target.value)}
          />
        </label>
      </div>
      <label>
        SSH user
        <input
          value={draft.sshUser}
          aria-label="SSH user"
          aria-describedby="ssh-user-help"
          maxLength={64}
          required
          autoComplete="off"
          onChange={(event) => update("sshUser", event.target.value)}
        />
        <small id="ssh-user-help">{rootOnly ? "Initial setup requires root on Ubuntu 24.04/26.04 or Debian 12/13 (x86_64)." : "Use root, or an account allowed to administer Docker."}</small>
      </label>
      <label>
        SSH password
        <input
          value={draft.sshPassword}
          aria-label="SSH password"
          aria-describedby="ssh-password-help"
          type="password"
          required
          maxLength={1024}
          autoComplete="off"
          onChange={(event) => update("sshPassword", event.target.value)}
        />
        <small id="ssh-password-help">
          The server password from your provider. Your Noted password is chosen later.
        </small>
      </label>
    </section>
  );
}
