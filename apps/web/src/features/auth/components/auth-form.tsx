import { Notice } from "../../../components/ui/notice";
import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { useAuthentication } from "../hooks/use-authentication";
import { isDesktop } from "../../desktop/connection-context";

export function AuthForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const authentication = useAuthentication();
  const supportsRemember = isDesktop && navigator.userAgent.includes("Windows");
  const [remember, setRemember] = useState(supportsRemember);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    authentication.mutate(
      { username, password, remember },
      {
        onSuccess: () => {
          setPassword("");
        },
      },
    );
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h2>Welcome back.</h2>
      <p className="form-intro">Sign in to your notes.</p>

      <label>
        Username
        <input
          name="username"
          autoComplete="username"
          required
          maxLength={64}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Your username"
        />
      </label>

      <label>
        Password
        <input
          name="password"
          autoComplete="current-password"
          type="password"
          required
          minLength={12}
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Your password"
        />
      </label>

      {supportsRemember && (
        <label className="remember-sign-in">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          Keep me signed in
        </label>
      )}
      {authentication.isError && (
        <Notice tone="error">{authentication.error.message}</Notice>
      )}

      <Button
        type="submit"
        className="auth-submit"
        disabled={authentication.isPending}
      >
        {authentication.isPending ? (
          <LoaderCircle className="spin" size={17} />
        ) : (
          <>Sign in</>
        )}
      </Button>
    </form>
  );
}
