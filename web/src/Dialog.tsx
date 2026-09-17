import { XIcon, type Icon } from "@phosphor-icons/react";
import { useEffect, type ReactNode } from "react";
import { dialogBackdropClass, dialogShellClass, secondaryButtonClass } from "./ui";

/**
 * Shared shell for every dialog on the power screen: backdrop click, Escape,
 * and an icon + title header. Renders nothing when closed, so callers can keep
 * their dialogs mounted unconditionally.
 */
export default function Dialog({
  open,
  onClose,
  title,
  subtitle,
  icon: HeaderIcon,
  label,
  children,
  footer,
  className = "max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon: Icon;
  /** aria-label for the dialog; defaults to the title. */
  label?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className={dialogBackdropClass} role="presentation" onClick={onClose}>
      <section
        className={`${dialogShellClass} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/8 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/8 bg-white/5">
              <HeaderIcon className="size-5 text-neutral-300" />
            </span>
            <div>
              <h2 className="font-display text-lg tracking-wide text-neutral-100">{title}</h2>
              {subtitle && <p className="text-sm text-neutral-500">{subtitle}</p>}
            </div>
          </div>
          <button type="button" onClick={onClose} className={`${secondaryButtonClass} inline-flex items-center gap-2`}>
            <XIcon className="size-4" />
            Close
          </button>
        </div>

        {children}

        {footer && <div className="flex flex-col gap-2 border-t border-white/8 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</div>}
      </section>
    </div>
  );
}

/** One label/value line inside a dialog body. */
export function DialogField({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-white/5 py-2 last:border-b-0">
      <span className="text-xs uppercase tracking-[0.18em] text-neutral-500">{label}</span>
      <span className={`min-w-0 text-right text-sm text-neutral-100 ${mono ? "font-mono text-[13px]" : ""}`}>{children}</span>
    </div>
  );
}

/** Placeholder body for when the device hasn't reported anything yet. */
export function DialogEmpty({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-neutral-500">{children}</p>;
}
