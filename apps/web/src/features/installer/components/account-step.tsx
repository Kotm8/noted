import { Notice } from "../../../components/ui/notice";
import type { SetupStepProps } from "../types";

export function AccountStep({ draft, update }: SetupStepProps) {
  return (
    <section className="installation-step">
      <h1>Your Noted account</h1>
      <p>Sign in from any device with this username and password.</p>
      <label>
        Username
        <input
          autoFocus
          value={draft.username}
          required
          maxLength={64}
          autoComplete="username"
          placeholder="Your username"
          onChange={(event) => update("username", event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          value={draft.password}
          type="password"
          minLength={12}
          maxLength={256}
          required
          autoComplete="new-password"
          placeholder="At least 12 characters"
          onChange={(event) => update("password", event.target.value)}
        />
      </label>
      <label>
        Confirm password
        <input
          value={draft.confirmation}
          type="password"
          minLength={12}
          maxLength={256}
          required
          autoComplete="new-password"
          onChange={(event) => update("confirmation", event.target.value)}
        />
      </label>
      <Notice>
        <strong>Private, owner only</strong>
        <p>
          One account for this server. Invitations can come later. Your SSH
          password and Noted password serve different purposes.
        </p>
      </Notice>
    </section>
  );
}
