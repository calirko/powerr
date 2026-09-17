import { WarningIcon } from "@phosphor-icons/react";
import Dialog from "./Dialog";
import { dangerButtonClass, secondaryButtonClass } from "./ui";

/**
 * Destructive confirmation. `onConfirm` fires after the dialog has already been
 * closed by the caller, so the action's own feedback (the dot wave on the power
 * screen) is visible immediately instead of behind a backdrop.
 */
export default function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  body: string;
  confirmLabel: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={WarningIcon}
      title={title}
      className="max-w-md"
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => {
              onClose();
              onConfirm();
            }}
            className={`${dangerButtonClass} inline-flex items-center justify-center gap-2`}
          >
            <WarningIcon className="size-4" />
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="px-4 py-5 text-sm leading-6 text-neutral-300 sm:px-6">{body}</p>
    </Dialog>
  );
}
