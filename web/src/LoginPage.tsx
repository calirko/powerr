import { useState } from "react";
import type { FormEvent } from "react";
import { login } from "./api";
import { fieldClass, frameClass, pageShellClass, primaryButtonClass, subtitleClass, titleClass } from "./ui";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(password);
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "login failed");
      setPending(false);
    }
  }

  return (
    <main className={pageShellClass}>
      <form onSubmit={handleSubmit} className={`${frameClass} w-full max-w-sm space-y-5`}>
        <div className="space-y-2 text-center">
          <h1 className={titleClass}>powerr</h1>
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

        {error && <p className="text-center text-sm text-red-400">{error}</p>}

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
