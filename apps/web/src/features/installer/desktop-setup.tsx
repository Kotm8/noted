import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, LoaderCircle } from "lucide-react";
import { BrandIcon } from "../../components/ui/brand-icon";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/ui/notice";
import { desktopRequest } from "../desktop/desktop-request";
import { AccountStep } from "./components/account-step";
import { CleanupDialog } from "./components/cleanup-dialog";
import { DomainStep } from "./components/domain-step";
import { InstallationProgress } from "./components/installation-progress";
import { ReviewStep } from "./components/review-step";
import { ServerStep } from "./components/server-step";
import type { HostIdentity, InstallationJob, InstallationPlan, ServerRelease } from "./desktop-types";
import { initialInstallation, type InstallationDraft, type UpdateInstallation } from "./types";
import { normalizeDomain, validateStep } from "./validation";
import "../../styles/installer.css";

const steps = ["Server", "Domain", "Owner account", "Review", "Install"];

function restoreDraft(job: InstallationJob | null): InstallationDraft {
  const plan = job?.plan;
  return plan ? { ...initialInstallation, serverName: plan.serverName, host: plan.host.ip, port: String(plan.host.port), domain: plan.domain, username: plan.username } : initialInstallation;
}

interface Props {
  initialJob: InstallationJob | null;
  close: () => void;
  connected: () => Promise<void>;
}

export function DesktopSetup({ initialJob, close, connected }: Props) {
  const [step, setStep] = useState(initialJob && ["running", "waiting_dns"].includes(initialJob.status) ? 4 : 0);
  const [draft, setDraft] = useState(() => restoreDraft(initialJob));
  const [repository, setRepository] = useState(initialJob?.plan?.repository ?? "kotm8/noted");
  const [identity, setIdentity] = useState<HostIdentity | null>(null);
  const [release, setRelease] = useState<ServerRelease | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [job, setJob] = useState(initialJob);
  const [error, setError] = useState<string | null>(initialJob?.phase === "cleanup_retained" ? initialJob.detail : null);
  const [busy, setBusy] = useState(false);
  const [cleanupOpen, setCleanupOpen] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [step]);
  const update: UpdateInstallation = (key, value) => {
    setError(null);
    setDraft((current) => ({ ...current, [key]: value }));
    if (key === "host" || key === "port") { setIdentity(null); setTrusted(false); }
  };

  useEffect(() => {
    if (job?.status !== "running") return;
    let active = true;
    const poll = window.setInterval(() => {
      void desktopRequest<InstallationJob>("setup").then((next) => {
        if (active) { setJob(next); setError(null); }
        if (active && next.status === "cleaned") {
          setJob(null); setStep(0); setRelease(null); setIdentity(null); setTrusted(false);
          setError(next.phase === "cleanup_retained" ? next.detail : null);
          setDraft((current) => ({ ...current, sshPassword: "", password: "", confirmation: "" }));
        }
        if (active && next.status === "waiting_dns") setDraft((current) => ({ ...current, sshPassword: "", password: "", confirmation: "" }));
      }).catch(() => { if (active) setError("Could not read setup progress. Keep the app open and try again shortly."); });
    }, 1000);
    return () => { active = false; window.clearInterval(poll); };
  }, [job?.status]);

  async function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const validation = validateStep(step, draft);
    if (validation) { setError(validation); return; }
    if (step === 0 && draft.sshUser !== "root") { setError("Initial setup currently requires the root SSH account."); return; }
    setError(null);
    setBusy(true);
    try {
      if (step === 0) {
        setIdentity(await desktopRequest<HostIdentity>("setup/host", "POST", { ip: draft.host.trim(), port: Number(draft.port) }));
        setTrusted(false);
      }
      if (step === 2) await checkRelease();
      setStep((current) => current + 1);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not check setup."); }
    finally { setBusy(false); }
  }

  async function checkRelease() {
    const normalizedRepository = repository.trim().toLowerCase();
    const commit = job?.plan?.repository === normalizedRepository ? job.plan.releaseCommit : undefined;
    const next = await desktopRequest<ServerRelease>("setup/release", "POST", { repository: normalizedRepository, commit });
    setRelease(next);
  }

  async function install() {
    if (!identity || !release || !trusted) return;
    setBusy(true);
    setError(null);
    const plan: InstallationPlan = {
      host: { ip: draft.host.trim(), port: Number(draft.port) }, hostKey: identity.hostKey,
      serverName: draft.serverName.trim(), domain: normalizeDomain(draft.domain), username: draft.username.trim(),
      repository: repository.trim().toLowerCase(), releaseCommit: release.commit, manifestSha256: release.manifestSha256,
    };
    try {
      setJob(await desktopRequest<InstallationJob>("setup", "POST", { plan, sshUser: draft.sshUser, sshPassword: draft.sshPassword, password: draft.password }));
      setStep(4);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not start setup."); }
    finally { setBusy(false); }
  }

  async function verify() {
    setBusy(true);
    setError(null);
    try { setJob(await desktopRequest<InstallationJob>("setup/verify", "POST")); await connected(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "HTTPS is not ready yet."); }
    finally { setBusy(false); }
  }

  return (
    <main className="installer-screen">
      <header className="installer-header">
        <div className="wordmark"><BrandIcon decorative />Noted</div>
        <Button variant="ghost" size="small" onClick={close} disabled={busy || job?.status === "running"}>Connect to an existing server</Button>
      </header>
      <div className="installer-layout">
        <aside className="installer-navigation">
          <h2>Set up your server</h2><p>Your VPS. Your domain. Your notes.</p>
          <ol aria-label="Installation steps">{steps.map((name, index) => (
            <li key={name} aria-current={step === index ? "step" : undefined}><span>{index < step ? <Check size={14} /> : index + 1}</span>{name}</li>
          ))}</ol>
          <p className="installer-memory-note">Passwords stay in memory during setup. Your server address and installation progress are remembered.</p>
        </aside>
        <form className="installer-form" onSubmit={(event) => { void next(event); }}>
          <fieldset className="installation-fields" disabled={busy}>
            {step === 0 && <ServerStep draft={draft} update={update} rootOnly />}
            {step === 1 && <DomainStep draft={draft} update={update} />}
            {step === 2 && <><AccountStep draft={draft} update={update} /><label>Release repository<input value={repository} maxLength={200} required onChange={(event) => { setRepository(event.target.value); setRelease(null); }} placeholder="owner/noted" /><small>The public GitHub repository containing Noted releases.</small></label></>}
            {step === 3 && <>
              <ReviewStep draft={draft} preview={false} details={[["Release", `${release?.version} (${release?.commit.slice(0, 8)})`], ["SSH fingerprint", identity?.fingerprint ?? ""]]}>
                <label className="setup-checkbox"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} />I verified this SSH fingerprint with my VPS.</label>
                <p className="setup-help">Compare it with the host fingerprint from your provider or server console. Passwords are sent only after this key is verified.</p>
              </ReviewStep>
            </>}
          </fieldset>
          {step === 4 && job ? <InstallationProgress job={job} busy={busy} error={error} verify={() => { void verify(); }} retry={() => { setStep(0); setError(null); }} /> : <>
            {error && <Notice tone="error">{error}</Notice>}
            <footer className="installer-actions">
              <Button type="button" variant="ghost" disabled={step === 0 || busy} onClick={() => { setError(null); setStep((current) => current - 1); }}><ArrowLeft size={15} />Back</Button>
              {step < 3 ? <Button type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="animate-spin" /> : <ArrowRight size={15} />}{busy ? "Checking..." : step === 2 ? "Review setup" : "Continue"}</Button> : <Button type="button" disabled={busy || !trusted || !release} onClick={() => { void install(); }}>Install on server{busy && <LoaderCircle size={15} className="animate-spin" />}</Button>}
            </footer>
          </>}
          {job?.plan && ["failed", "waiting_dns"].includes(job.status) && <section className="installer-danger-zone">
            <div><h3>Danger Zone</h3><p>Remove Noted and its data to start setup again.</p></div>
            <Button variant="danger" type="button" disabled={busy} onClick={() => setCleanupOpen(true)}>Clean Noted from VPS</Button>
          </section>}
        </form>
      </div>
      {cleanupOpen && job?.plan && <CleanupDialog plan={job.plan} close={() => setCleanupOpen(false)} started={(next) => {
        setCleanupOpen(false); setJob(next); setStep(4); setError(null);
      }} />}
    </main>
  );
}
