import { Notice } from "../../../components/ui/notice";
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { settingsApi } from "../api";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [validation, setValidation] = useState("");
  const mutation = useMutation({
    mutationFn: () => settingsApi.changePassword(current, password),
    onSuccess: () => {
      setCurrent("");
      setPassword("");
      setConfirmation("");
      toast.success("Password updated. Other sessions were signed out.");
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password !== confirmation) {
      setValidation("The new passwords do not match.");
      return;
    }
    setValidation("");
    mutation.mutate();
  }

  return (
    <form className="password-form" onSubmit={submit}>
      <h3>Owner password</h3>
      <p>Changing your password signs out other sessions.</p>
      <label>
        Current password
        <input
          type="password"
          autoComplete="current-password"
          required
          maxLength={256}
          value={current}
          onChange={(event) => setCurrent(event.target.value)}
        />
      </label>
      <label>
        New password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <label>
        Confirm new password
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          maxLength={256}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      {(validation || mutation.isError) && (
        <Notice tone="error">{validation || mutation.error?.message}</Notice>
      )}
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? "Updating password..." : "Change password"}
      </Button>
    </form>
  );
}
