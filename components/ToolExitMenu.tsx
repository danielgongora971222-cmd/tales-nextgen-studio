import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppRoute } from "../types";
import styles from "./ToolExitMenu.module.css";

type Props = {
  className?: string;
  title?: string;
  ariaLabel?: string;
  onBeforeNavigate?: (route: AppRoute) => void;
  children?: React.ReactNode;
};

type MenuEntry = {
  key: string;
  label: string;
  route?: AppRoute;
  disabled?: boolean;
  meta?: string;
  featured?: boolean;
};

const MENU_ITEMS: MenuEntry[] = [
  { key: "home", label: "Home", route: AppRoute.HOME, featured: true },
  { key: "image-tools", label: "Image tools", route: AppRoute.IMAGE_GEN_ROOT },
  { key: "video-tools", label: "Video tools", route: AppRoute.VIDEO_GEN },
  { key: "onenationup", label: "1NationUp", route: AppRoute.STORE },
  { key: "smart-assistant", label: "Smart assistant", disabled: true, meta: "Coming soon" },
  { key: "audio-tools", label: "Audio tools", disabled: true, meta: "Coming soon" },
  { key: "plans-and-credits", label: "Plans and extra credits", route: AppRoute.PAYWALL },
];

export default function ToolExitMenu({
  className,
  title = "Close",
  ariaLabel = "Open tool exit menu",
  onBeforeNavigate,
  children,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const el = rootRef.current;
      if (el && !el.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const menuItems = useMemo(() => MENU_ITEMS, []);

  const navigate = (route: AppRoute) => {
    setOpen(false);

    try {
      onBeforeNavigate?.(route);
    } catch {
      // noop
    }

    if (route === AppRoute.PAYWALL && typeof window !== "undefined") {
      try {
        window.localStorage.setItem("tales_account_tab", "plans");
      } catch {
        // noop
      }
    }

    window.dispatchEvent(new CustomEvent("tales:navigate", { detail: { route } }));
  };

  return (
    <div className={styles.shell} ref={rootRef}>
      <button
        type="button"
        className={className}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {children ?? "×"}
      </button>

      {open && (
        <div className={styles.menu} role="menu" aria-label="Tool exit destinations">
          <div className={styles.menuHeader}>Where do you want to go?</div>
          <div className={styles.menuList}>
            {menuItems.map((item) => {
              if (item.disabled || !item.route) {
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`${styles.item} ${item.featured ? styles.itemFeatured : ""} ${styles.itemDisabled}`}
                    disabled
                  >
                    <span className={styles.itemLabel}>{item.label}</span>
                    {item.meta ? <span className={styles.itemMeta}>{item.meta}</span> : null}
                  </button>
                );
              }

              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className={`${styles.item} ${item.featured ? styles.itemFeatured : ""}`}
                  onClick={() => navigate(item.route!)}
                >
                  <span className={styles.itemLabel}>{item.label}</span>
                  {item.meta ? <span className={styles.itemMeta}>{item.meta}</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
