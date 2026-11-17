import { ImageIcon } from "lucide-react";
import { photoUrl } from "../api";
import { PictureMenu } from "../../../components/ui/picture-menu";

export function SavedFoodPhoto({
  id,
  name = "",
  large = false,
}: {
  id?: string;
  name?: string;
  large?: boolean;
}) {
  return id ? (
    <PictureMenu url={photoUrl(id)} name={`${name || "saved-food"}.webp`}>
      <img
        className={`saved-food-photo ${large ? "large" : ""}`}
        src={photoUrl(id)}
        alt={name ? `${name} photo` : ""}
        loading="lazy"
      />
    </PictureMenu>
  ) : (
    <span
      className={`saved-food-photo photo-empty ${large ? "large" : ""}`}
      aria-hidden="true"
    >
      <ImageIcon size={large ? 24 : 18} />
    </span>
  );
}
