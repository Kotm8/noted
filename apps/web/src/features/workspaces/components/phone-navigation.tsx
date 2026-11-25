import { useRef } from "react";
import {
  Apple,
  CalendarDays,
  ClipboardCheck,
  House,
  Wallet,
} from "lucide-react";
import { useNutritionEnabled } from "../../ai/queries";
import "./phone-navigation.css";

export function PhoneNavigation({
  active,
  openPage,
}: {
  active: string;
  openPage: (path: string) => void;
}) {
  const nutrition = useNutritionEnabled();
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const home = active === "/" || active === "/home";
  const tabs = [
    {
      label: "Home",
      icon: House,
      current: home,
      open: () => {
        if (home)
          document.querySelector(".phone-home-scroll")?.scrollTo({ top: 0 });
        else openPage("/");
      },
    },
    nutrition
      ? {
          label: "Food",
          icon: Apple,
          current: active === "/nutrition",
          open: () => openPage("/nutrition"),
        }
      : {
          label: "Habits",
          icon: ClipboardCheck,
          current: active === "/habits",
          open: () => openPage("/habits"),
        },
    {
      label: "Calendar",
      icon: CalendarDays,
      current: active === "/schedule",
      open: () => openPage("/schedule"),
    },
    {
      label: "Finance",
      icon: Wallet,
      current: active === "/finance",
      open: () => openPage("/finance"),
    },
  ];
  const current = tabs.findIndex((tab) => tab.current);
  return (
    <nav
      className="phone-navigation"
      aria-label="Main navigation"
      onPointerDown={(event) => {
        if (event.pointerType !== "touch" || !event.isPrimary) return;
        swiped.current = false;
        gesture.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={(event) => {
        const start = gesture.current;
        gesture.current = null;
        if (!start || !event.isPrimary) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        swiped.current = true;
        if (current >= 0) tabs[current + (dx < 0 ? 1 : -1)]?.open();
      }}
      onPointerCancel={() => {
        gesture.current = null;
      }}
      onClickCapture={(event) => {
        if (!event.detail || !swiped.current) return;
        swiped.current = false;
        event.stopPropagation();
      }}
    >
      {tabs.map(({ label, icon: Icon, current, open }) => (
        <button
          key={label}
          aria-current={current ? "page" : undefined}
          onClick={open}
        >
          <Icon size={20} />
          {label}
        </button>
      ))}
    </nav>
  );
}
