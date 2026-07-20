import { useState } from "react";
import type { FormEvent } from "react";
import { login } from "./api";

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
    <main className="flex min-h-dvh items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-xs space-y-6">
        <h1 className="text-center font-display text-2xl tracking-tight">powerr</h1>

        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-center text-neutral-100 outline-none focus:border-neutral-500"
        />

        {error && <p className="text-center text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending || !password}
          className="w-full rounded-xl bg-neutral-100 py-3 font-medium text-neutral-950 transition disabled:opacity-30"
        >
          {pending ? "..." : "Log in"}
        </button>
      </form>
    </main>
  );
}
