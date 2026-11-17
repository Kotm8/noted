import { ContextMenu } from "../../components/ui/context-menu";
import { MenuItem } from "../../components/ui/menu";
import { PictureMenu } from "../../components/ui/picture-menu";
import { useState } from "react";
import { ExternalLink, Image, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/confirm-dialog";
import { photoUrl, useFinanceAction } from "./api";
import { dateLabel, money } from "./money";
import {
  itemsOf,
  type FinanceBoard,
  type Item,
  type Purchase,
  type Reservation,
} from "./types";
import type { EditorTarget } from "./editor";

export function Purchases({
  board,
  onEdit,
}: {
  board: FinanceBoard;
  onEdit: (target: EditorTarget) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showBought, setShowBought] = useState(false);
  const [removing, setRemoving] = useState<Item<Purchase> | null>(null);
  const action = useFinanceAction();
  const purchases = itemsOf<Purchase>(board, "purchase").filter(
    (item) => showBought || item.fields.status !== "bought",
  );
  const focused =
    purchases.find((item) => item.id === selected) ?? purchases[0];
  const reservations = itemsOf<Reservation>(board, "reservation");
  const saved = (id: string) =>
    reservations
      .filter((item) => item.fields.purchase_id === id)
      .reduce((sum, item) => sum + item.fields.amount, 0);
  const picture = (item: Item<Purchase>) =>
    item.fields.photo_ids[0] ? (
      <PictureMenu
        url={photoUrl(item.fields.photo_ids[0])}
        name={item.fields.name}
      >
        <img src={photoUrl(item.fields.photo_ids[0])} alt={item.fields.name} />
      </PictureMenu>
    ) : (
      <span className="finance-purchase-placeholder">
        <Image size={32} />
      </span>
    );
  const menu = (item: Item<Purchase>) => (
    <>
      <MenuItem onSelect={() => setSelected(item.id)}>View purchase</MenuItem>
      <MenuItem
        onSelect={() =>
          onEdit({
            entity: "purchase",
            id: item.id,
            revision: item.revision,
            fields: { ...item.fields },
          })
        }
      >
        Edit purchase
      </MenuItem>
      {item.fields.status !== "bought" && (
        <MenuItem
          onSelect={() =>
            onEdit({
              entity: "purchase",
              id: item.id,
              revision: item.revision,
              operation: "buy",
              fields: {
                amount: item.fields.price,
                name: item.fields.name,
                day: board.today,
                account_id: board.settings.default_account_id,
              },
            })
          }
        >
          Mark bought
        </MenuItem>
      )}
      <MenuItem
        danger
        disabled={action.isPending}
        onSelect={() => setRemoving(item)}
      >
        Delete purchase
      </MenuItem>
    </>
  );
  return (
    <section className="finance-purchases">
      <div className="finance-section-heading">
        <h2>Planned purchases</h2>
        <div>
          <label className="finance-check">
            <input
              type="checkbox"
              checked={showBought}
              onChange={(event) => setShowBought(event.target.checked)}
            />
            Show bought
          </label>
          <Button
            size="small"
            variant="secondary"
            onClick={() => onEdit({ entity: "purchase" })}
          >
            <Plus size={15} />
            Add purchase
          </Button>
        </div>
      </div>
      {focused ? (
        <>
          <ContextMenu
            label={`Actions for purchase ${focused.fields.name}`}
            menu={menu(focused)}
          >
            <section className="finance-purchase-focus">
              <div className="finance-purchase-cover">{picture(focused)}</div>
              <div>
                <span className="finance-eyebrow">
                  {focused.fields.status === "bought"
                    ? "BOUGHT"
                    : `${focused.fields.priority.toUpperCase()} PRIORITY`}
                </span>
                <h2>{focused.fields.name}</h2>
                <p>{focused.fields.notes}</p>
                <div className="finance-purchase-price">
                  <strong>
                    {money(saved(focused.id), board.settings.currency, true)}
                  </strong>
                  <span>
                    of{" "}
                    {money(focused.fields.price, board.settings.currency, true)}{" "}
                    set aside
                  </span>
                </div>
                <div className="finance-progress">
                  <span
                    style={{
                      width: `${Math.min(100, (saved(focused.id) / focused.fields.price) * 100)}%`,
                    }}
                  />
                </div>
                {focused.fields.target_date && (
                  <p className="finance-purchase-date">
                    Target {dateLabel(focused.fields.target_date)}
                  </p>
                )}
                <div className="finance-purchase-actions">
                  {focused.fields.status !== "bought" && (
                    <>
                      <Button
                        size="small"
                        onClick={() =>
                          onEdit({
                            entity: "purchase",
                            id: focused.id,
                            revision: focused.revision,
                            operation: "buy",
                            fields: {
                              ...focused.fields,
                              amount: focused.fields.price,
                            },
                          })
                        }
                      >
                        Mark bought
                      </Button>
                      {saved(focused.id) < focused.fields.price && (
                        <Button
                          size="small"
                          variant="secondary"
                          onClick={() =>
                            onEdit({
                              entity: "reservation",
                              fields: {
                                purchase_id: focused.id,
                                amount: Math.min(
                                  2500,
                                  focused.fields.price - saved(focused.id),
                                ),
                              },
                            })
                          }
                        >
                          Set aside
                        </Button>
                      )}
                    </>
                  )}
                  <Button
                    size="small"
                    variant="ghost"
                    onClick={() =>
                      onEdit({
                        entity: "purchase",
                        id: focused.id,
                        revision: focused.revision,
                        fields: { ...focused.fields },
                      })
                    }
                  >
                    Edit
                  </Button>
                  {focused.fields.link && (
                    <a
                      href={focused.fields.link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} />
                      Product
                    </a>
                  )}
                  <button
                    className="icon-button"
                    aria-label="Delete purchase"
                    onClick={() => setRemoving(focused)}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </section>
          </ContextMenu>
          <div className="finance-goal-lanes">
            {purchases.map((item) => (
              <ContextMenu
                key={item.id}
                label={`Actions for purchase ${item.fields.name}`}
                menu={menu(item)}
              >
                <button
                  aria-pressed={focused.id === item.id}
                  onClick={() => setSelected(item.id)}
                >
                  {picture(item)}
                  <span>
                    <strong>{item.fields.name}</strong>
                    <span>
                      {item.fields.status === "bought"
                        ? "Bought"
                        : `${money(saved(item.id), board.settings.currency, true)} / ${money(item.fields.price, board.settings.currency, true)}`}
                    </span>
                  </span>
                  <span className="finance-progress">
                    <span
                      style={{
                        width: `${Math.min(100, (saved(item.id) / item.fields.price) * 100)}%`,
                      }}
                    />
                  </span>
                </button>
              </ContextMenu>
            ))}
          </div>
        </>
      ) : (
        <p className="finance-empty finance-empty-large">
          Add something you are considering or saving toward.
        </p>
      )}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        keepLabel="Keep purchase"
        title="Delete this purchase?"
        description="Its reservations will be released. Existing expenses stay in your ledger."
        confirmLabel="Delete purchase"
        pending={action.isPending}
        onConfirm={() => {
          if (removing)
            action.mutate(
              {
                entity: "purchase",
                id: removing.id,
                revision: removing.revision,
                operation: "delete",
              },
              {
                onSuccess: (result) => {
                  setRemoving(null);
                  toast.success("Purchase deleted", {
                    action: {
                      label: "Undo",
                      onClick: () =>
                        action.mutate({
                          entity: "purchase",
                          operation: "restore",
                          id: result.id,
                          revision: result.revision,
                        }),
                    },
                  });
                },
              },
            );
        }}
      />
    </section>
  );
}
