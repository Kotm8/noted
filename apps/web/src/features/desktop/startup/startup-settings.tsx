import { Notice } from "../../../components/ui/notice";
import { useDesktopStartup } from "./use-desktop-startup";

export function StartupSettings() {
  const { query, change } = useDesktopStartup();
  const value = query.data;
  return (
    <section className="settings-section">
      <h3>Startup</h3>
      <p>
        Noted can open when you sign in to Windows, so reminders and the tracker
        are there without starting it yourself.
      </p>
      {query.error && <Notice tone="error">{query.error.message}</Notice>}
      {value && (
        <div className="desktop-startup-options">
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.enabled}
              disabled={change.isPending}
              onChange={(event) =>
                change.mutate({ enabled: event.target.checked, asked: true })
              }
            />
            Start with Windows
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={value.minimized}
              disabled={!value.enabled || change.isPending}
              onChange={(event) =>
                change.mutate({ minimized: event.target.checked })
              }
            />
            Start minimized to the taskbar
          </label>
        </div>
      )}
      {change.error && <Notice tone="error">{change.error.message}</Notice>}
    </section>
  );
}
