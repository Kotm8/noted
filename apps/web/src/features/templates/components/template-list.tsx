import { CalendarDays, FileText, Plus, Search } from "lucide-react";
import { useState } from "react";

export function TemplateList({
  items,
  selected,
  onSelect,
  onNew,
  kind,
  search = false,
  disabled = false,
}: {
  items: { id: string; name: string; detail: string }[];
  selected: string;
  onSelect: (id: string) => void;
  onNew?: () => void;
  kind: "day" | "note";
  search?: boolean;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const Icon = kind === "day" ? CalendarDays : FileText;
  return (
    <div className="template-list">
      {search && (
        <label className="template-search">
          <Search size={14} />
          <input
            aria-label="Find a template"
            placeholder="Find a template"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      )}
      <div className="template-list-items">
        {filtered.map((item) => (
          <button
            type="button"
            key={item.id}
            className="template-list-row"
            aria-pressed={selected === item.id}
            onClick={() => onSelect(item.id)}
            disabled={disabled}
          >
            <Icon size={16} />
            <span>
              <strong>{item.name}</strong>
              <small>{item.detail}</small>
            </span>
          </button>
        ))}
      </div>
      {!filtered.length && (
        <p className="template-empty">
          {items.length ? "No matching templates." : "No templates yet."}
        </p>
      )}
      {onNew && (
        <button
          type="button"
          className="template-new"
          onClick={onNew}
          disabled={disabled}
        >
          <Plus size={14} />
          New template
        </button>
      )}
    </div>
  );
}
