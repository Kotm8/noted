import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Image, ImagePlus, X } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Notice } from "../../../components/ui/notice";

interface ChannelImagePickerProps {
  image: File | null | undefined;
  existingImage?: string | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
}

export function ChannelImagePicker({
  image,
  existingImage,
  disabled,
  onChange,
}: ChannelImagePickerProps) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageUrl = preview ?? (image === undefined ? existingImage : null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("Choose an image or GIF no larger than 5 MB.");
      return;
    }
    setError(null);
    onChange(file);
    setPreview(URL.createObjectURL(file));
  }

  return (
    <fieldset className="channel-image-picker" disabled={disabled}>
      <legend>Channel image</legend>
      <div className="channel-image-preview">
        {imageUrl ? <img src={imageUrl} alt="Channel image preview" /> : <Image size={24} />}
      </div>
      <div className="channel-image-actions">
        <Button
          type="button"
          variant="secondary"
          size="small"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <ImagePlus size={14} />
          {imageUrl ? "Change image or GIF" : "Choose image or GIF"}
        </Button>
        {imageUrl && (
          <Button
            type="button"
            variant="ghost"
            size="small"
            disabled={disabled}
            onClick={() => {
              onChange(null);
              setPreview(null);
              setError(null);
            }}
          >
            <X size={13} />
            Remove image
          </Button>
        )}
      </div>
      <input
        ref={input}
        hidden
        type="file"
        aria-label="Channel image file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={chooseImage}
      />
      <p>
        Shown above the channel list. Stretched to 2:1 and resized to 512 × 256.
        GIFs stay animated. Up to 5 MB.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
    </fieldset>
  );
}
