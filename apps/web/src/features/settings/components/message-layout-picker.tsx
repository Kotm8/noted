import { messageLayouts } from "../appearance";
import { useAppearance } from "../appearance-context";

export function MessageLayoutPicker() {
  const { preferences, update } = useAppearance();
  return (
    <fieldset className="settings-fieldset message-layout-picker">
      <legend>Message layout</legend>
      <div className="message-layout-options">
        {Object.entries(messageLayouts).map(([layout, details]) => (
          <label className="message-layout-option" key={layout}>
            <input
              className="visually-hidden"
              type="radio"
              name="message-layout"
              aria-label={details.label}
              value={layout}
              checked={preferences.messageLayout === layout}
              onChange={() => update({ messageLayout: layout as keyof typeof messageLayouts })}
            />
            <span className={`message-layout-sample sample-${layout}`} aria-hidden="true">
              <span className="sample-time">13:43</span>
              <span className="sample-line" />
              <span className="sample-line sample-short" />
              <span className="sample-line" />
            </span>
            <strong>{details.label}</strong>
            <span className="message-layout-description">{details.description}</span>
          </label>
        ))}
      </div>
      <p className="settings-hint">
        A pause of more than two minutes starts a new group. Each note stays independently editable.
      </p>
    </fieldset>
  );
}
