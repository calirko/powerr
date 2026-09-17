import type { CSSProperties } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";

function XCircleIcon() {
  return (
    <svg viewBox="0 0 256 256" fill="currentColor" className="size-4" aria-hidden="true">
      <path d="M165.66,101.66,139.31,128l26.35,26.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z" />
    </svg>
  );
}

// Mirrors mkweb's Toaster theming (dark variant only, since this app has no light theme).
export default function Toaster(props: ToasterProps) {
  const isMobile = window.matchMedia("(max-width: 767px)").matches;

  return (
    <Sonner
      theme="dark"
      richColors
      position={isMobile ? "top-center" : "bottom-center"}
      visibleToasts={3}
      expand
      className="toaster group"
      icons={{ error: <XCircleIcon /> }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",

          "--error-bg": "color-mix(in oklab, var(--destructive) 20%, var(--popover))",
          "--error-border": "transparent",
          "--error-text": "var(--destructive)",
        } as CSSProperties
      }
      toastOptions={{ classNames: { toast: "cn-toast" } }}
      {...props}
    />
  );
}
