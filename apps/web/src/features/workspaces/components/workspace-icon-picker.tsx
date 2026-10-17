import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";

const icons = [
  ["✦", "Star"], ["📚", "Books"], ["💻", "Computer"], ["🌿", "Plant"],
  ["☕", "Coffee"], ["🎨", "Art"], ["💡", "Idea"], ["📝", "Notes"],
  ["🏠", "Home"], ["🧠", "Learning"], ["🎮", "Games"], ["🎵", "Music"],
  ["🎬", "Movies"], ["📷", "Photography"], ["🌙", "Moon"], ["☀️", "Sun"],
  ["🌻", "Flower"], ["🍃", "Leaf"], ["🌊", "Ocean"], ["🔥", "Fire"],
  ["🛠️", "Tools"], ["🚀", "Rocket"], ["🧪", "Experiments"], ["🔭", "Research"],
  ["📦", "Projects"], ["🗂️", "Files"], ["🔖", "Bookmarks"], ["📅", "Calendar"],
  ["🎯", "Goals"], ["🏋️", "Fitness"], ["🍳", "Cooking"], ["🐈", "Cat"],
] as const;

interface WorkspaceIconPickerProps {
  value: string;
  image: File | null | undefined;
  existingImage?: string | null;
  disabled: boolean;
  onChange: (icon: string) => void;
  onImageChange: (file: File | null) => void;
}

function navigateIcons(event: KeyboardEvent<HTMLDivElement>) {
  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
  const index = buttons.indexOf(event.target as HTMLButtonElement);
  const columns = getComputedStyle(event.currentTarget).gridTemplateColumns.split(" ").length;
  const next = event.key === "ArrowRight" ? index + 1
    : event.key === "ArrowLeft" ? index - 1
    : event.key === "ArrowDown" ? index + columns
    : event.key === "ArrowUp" ? index - columns
    : event.key === "Home" ? 0
    : event.key === "End" ? buttons.length - 1 : null;
  if (index < 0 || next === null) return;
  event.preventDefault();
  buttons[(next + buttons.length) % buttons.length]?.focus();
}

export function WorkspaceIconPicker({
  value,
  image,
  existingImage,
  disabled,
  onChange,
  onImageChange,
}: WorkspaceIconPickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageUrl = preview ?? (image === undefined ? existingImage : null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function removeImage() {
    onImageChange(null);
    setPreview(null);
    setError(null);
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose an image or GIF no larger than 5 MB.");
      return;
    }
    setError(null);
    onImageChange(file);
    setPreview(URL.createObjectURL(file));
  }

  return (
    <fieldset className="workspace-icon-picker" disabled={disabled}>
      <legend>Workspace icon</legend>
      <div className="workspace-icon-header">
        <div className="workspace-image-preview">
          {imageUrl ? <img src={imageUrl} alt="Workspace icon preview" /> : <span>{value}</span>}
        </div>
        <div className="workspace-icon-actions">
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <ImagePlus size={14} />
            {imageUrl ? "Change image or GIF" : "Import image or GIF"}
          </Button>
          {imageUrl && (
            <Button
              type="button"
              variant="ghost"
              size="small"
              disabled={disabled}
              onClick={removeImage}
            >
              <X size={13} />
              Remove image
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        aria-label="Workspace image file"
        onChange={chooseImage}
      />
      <div
        className="workspace-icon-grid"
        role="group"
        aria-label="Choose an icon"
        onKeyDown={navigateIcons}
      >
        {icons.map(([icon, label]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={!imageUrl && value === icon}
            onClick={() => {
              onChange(icon);
              removeImage();
            }}
          >
            {icon}
          </button>
        ))}
      </div>
      <p>
        Images are stretched to a square and resized to 512 × 512.
        GIFs stay animated. Up to 5 MB.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </fieldset>
  );
}
