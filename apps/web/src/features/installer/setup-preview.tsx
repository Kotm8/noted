import { Notice } from "../../components/ui/notice";
import { BrandIcon } from "../../components/ui/brand-icon";
import { useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ServerStep } from "./components/server-step";
import { DomainStep } from "./components/domain-step";
import { AccountStep } from "./components/account-step";
import { AndroidNotificationsStep } from "./components/android-notifications-step";
import { firebaseProject } from "./firebase";
import { ReviewStep } from "./components/review-step";
import { initialInstallation, type UpdateInstallation } from "./types";
import { validateStep } from "./validation";
import "../../styles/installer.css";

const steps = [
  "Server",
  "Domain",
  "Owner account",
  "Android notifications",
  "Review",
];

export function SetupPreview() {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(initialInstallation);
  const [error, setError] = useState<string | null>(null);
  const update: UpdateInstallation = (key, value) => {
    setError(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateStep(step, draft);
    setError(validation);
    if (!validation) {
      setStep((current) => Math.min(4, current + 1));
      window.scrollTo(0, 0);
    }
  }

  function back() {
    setError(null);
    setStep((current) => Math.max(0, current - 1));
    window.scrollTo(0, 0);
  }

  return (
    <main className="installer-screen">
      <header className="installer-header">
        <div className="wordmark">
          <BrandIcon decorative />
          Noted
        </div>
        <span>Desktop installer preview</span>
      </header>
      <div className="installer-layout">
        <aside className="installer-navigation">
          <h2>Set up your server</h2>
          <p>Your VPS. Your domain. Your notes.</p>
          <ol aria-label="Installation steps">
            {steps.map((name, index) => (
              <li key={name} aria-current={step === index ? "step" : undefined}>
                <span>{index < step ? <Check size={14} /> : index + 1}</span>
                {name}
              </li>
            ))}
          </ol>
          <p className="installer-memory-note">
            Preview only. No server connection is made, and passwords are not
            saved or sent.
          </p>
        </aside>
        <form className="installer-form" onSubmit={next}>
          {step === 0 && <ServerStep draft={draft} update={update} />}
          {step === 1 && <DomainStep draft={draft} update={update} />}
          {step === 2 && <AccountStep draft={draft} update={update} />}
          {step === 3 && (
            <AndroidNotificationsStep draft={draft} update={update} />
          )}
          {step === 4 && (
            <ReviewStep
              draft={draft}
              details={[
                [
                  "Android notifications",
                  draft.androidNotifications
                    ? `Firebase: ${firebaseProject(draft)}`
                    : "Firebase skipped",
                ],
              ]}
            />
          )}
          {error && <Notice tone="error">{error}</Notice>}
          <footer className="installer-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={step === 0}
              onClick={back}
            >
              <ArrowLeft size={15} />
              Back
            </Button>
            {step < 4 ? (
              <Button type="submit">
                {step === 3 ? "Review setup" : "Continue"}
                <ArrowRight size={15} />
              </Button>
            ) : (
              <Button type="button" disabled>
                Install on server
              </Button>
            )}
          </footer>
        </form>
      </div>
    </main>
  );
}
