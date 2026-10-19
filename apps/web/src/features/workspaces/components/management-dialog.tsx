import { Notice } from "../../../components/ui/notice";
import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Modal } from "../../../components/ui/dialog";
import { useManageEntity } from "../hooks/use-manage-entity";
import type { Category, ManagementAction } from "../types";
import { WorkspaceIconPicker } from "./workspace-icon-picker";
import { ChannelImagePicker } from "./channel-image-picker";
import { Select } from "../../../components/ui/select";
import type { Channel } from "../types";

interface ManagementDialogProps {
  action: ManagementAction;
  categories: Category[];
  onClose: () => void;
}

const descriptions = {
  workspace: "Group related channels in a workspace.",
  category: "Organize channels under a category.",
  channel: "Choose a chat, Markdown notes page, reminder feed, or journal.",
};

export function ManagementDialog({
  action,
  categories,
  onClose,
}: ManagementDialogProps) {
  const [name, setName] = useState(action.item?.name ?? "");
  const [kind, setKind] = useState<NonNullable<Channel["kind"]>>(
    action.kind === "channel" ? (action.item?.kind ?? "note") : "note",
  );
  const [icon, setIcon] = useState(
    action.kind === "workspace" ? (action.item?.icon ?? "✦") : "✦",
  );
  const initialCategory =
    action.kind === "channel"
      ? (action.item?.category_id ?? action.categoryId)
      : null;
  const [categoryId, setCategoryId] = useState(initialCategory ?? "");
  const [image, setImage] = useState<File | null | undefined>(undefined);
  const mutation = useManageEntity(action, onClose);
  const verb = action.deleting ? "Delete" : action.item ? "Edit" : "Create";
  const description = action.deleting
    ? `This permanently deletes ${action.item?.name} and everything inside it.`
    : descriptions[action.kind];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    mutation.mutate({ name, icon, categoryId, image, kind });
  }

  function handleOpenChange(open: boolean) {
    if (!open && !mutation.isPending) onClose();
  }

  return (
    <Modal
      open
      onOpenChange={handleOpenChange}
      title={`${verb} ${action.kind}`}
      description={description}
    >
      <form onSubmit={handleSubmit} className="management-form">
        {!action.deleting && (
          <>
            <label>
              Name
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                required
                placeholder={
                  action.kind === "channel"
                    ? "e.g. little-ideas"
                    : "Give it a name"
                }
              />
            </label>
            {action.kind === "workspace" && (
              <WorkspaceIconPicker
                value={icon}
                image={image}
                existingImage={action.item?.icon_url}
                disabled={mutation.isPending}
                onChange={setIcon}
                onImageChange={setImage}
              />
            )}
            {action.kind === "channel" && (
              <ChannelImagePicker
                image={image}
                existingImage={action.item?.banner_url}
                disabled={mutation.isPending}
                onChange={setImage}
              />
            )}
            {action.kind === "channel" && (
              <label>
                Channel type
                <Select
                  label="Channel type"
                  value={kind}
                  onChange={(value) =>
                    setKind(value as NonNullable<Channel["kind"]>)
                  }
                  options={[
                    { value: "note", label: "Chat" },
                    { value: "document", label: "Notes" },
                    { value: "reminder", label: "Reminders" },
                    { value: "journal", label: "Journal" },
                  ]}
                />
              </label>
            )}
            {action.kind === "channel" && (
              <label>
                Category
                <select
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        {action.deleting && (
          <Notice tone="warning">
            Deleted notes cannot be recovered from the app. This action cannot
            be undone.
          </Notice>
        )}
        {mutation.isError && (
          <Notice tone="error">{mutation.error.message}</Notice>
        )}

        <div className="dialog-actions">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant={action.deleting ? "danger" : "default"}
            disabled={mutation.isPending || (!action.deleting && !name.trim())}
          >
            {mutation.isPending ? (
              <LoaderCircle size={16} className="animate-spin" />
            ) : (
              `${verb} ${action.kind}`
            )}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
