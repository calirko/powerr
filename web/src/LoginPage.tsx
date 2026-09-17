import { useState } from "react";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { login } from "./api";
import Logo from "./Logo";
import { fieldClass, frameClass, pageShellClass, primaryButtonClass, subtitleClass, titleClass } from "./ui";

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      await login(password);
      onLoggedIn();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "login failed");
      setPending(false);
    }
  }

  return (
    <main className={pageShellClass}>
      <form onSubmit={handleSubmit} className={`${frameClass} w-full max-w-sm space-y-5`}>
        <div className="space-y-2 text-center">
          <h1 className={`${titleClass} flex items-center justify-center gap-2.5`}>
            <Logo className="size-6" />
            powerr
          </h1>
          <p className={subtitleClass}>Sign in to watch the device and power controls in one place.</p>
        </div>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className={fieldClass}
        />

        <button
          type="submit"
          disabled={pending || !password}
          className={`${primaryButtonClass} w-full`}
        >
          {pending ? "..." : "Log in"}
        </button>
      </form>
    </main>
  );
}
