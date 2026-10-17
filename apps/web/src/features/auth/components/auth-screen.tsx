import { AuthForm } from "./auth-form";
import { AuthBrand } from "./auth-brand";
import { Notice } from "../../../components/ui/notice";
import { SwitchServerButton } from "../../desktop/switch-server-button";

export function AuthScreen({ setup }: { setup: boolean }) {
  return (
    <main className="auth-screen">
      <AuthBrand />
      <section className="auth-form-section">
        {setup && (
          <Notice>
            Server setup is unfinished. Create the owner account through the installer before
            signing in.
          </Notice>
        )}
        <AuthForm />
      </section>
      <footer className="auth-footer">Self-hosted · Noted 0.1.0</footer>
      <SwitchServerButton />
    </main>
  );
}
