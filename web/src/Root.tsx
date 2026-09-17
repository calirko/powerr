import { IconContext } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import LoginPage from "./LoginPage";
import PowerPage from "./PowerPage";
import Toaster from "./Toaster";
import { checkSession } from "./api";
import { screenEnterClass, screenExitClass } from "./ui";

type Screen = "checking" | "login" | "power";

// Must match the duration in screenExitClass.
const SCREEN_EXIT_MS = 500;

export default function Root() {
  const [screen, setScreen] = useState<Screen>("checking");
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const onLoginPage = window.location.pathname === "/login";

    checkSession().then((authenticated) => {
      if (authenticated) {
        if (onLoginPage) {
          window.location.replace("/");
          return;
        }
        setScreen("power");
      } else {
        if (!onLoginPage) {
          window.location.replace("/login");
          return;
        }
        setScreen("login");
      }
    });
  }, []);

  // Fade the login screen out, then swap to the power screen in place (no reload) so it can fade in.
  function handleLoggedIn() {
    setLeaving(true);
    window.setTimeout(() => {
      window.history.replaceState(null, "", "/");
      setScreen("power");
      setLeaving(false);
    }, SCREEN_EXIT_MS);
  }

  return (
    // Every icon in the app is a Phosphor duotone; set it once here instead of per-icon.
    <IconContext.Provider value={{ weight: "duotone" }}>
      {screen !== "checking" && (
        <div key={screen} className={leaving ? screenExitClass : screenEnterClass}>
          {screen === "login" ? <LoginPage onLoggedIn={handleLoggedIn} /> : <PowerPage />}
        </div>
      )}
      <Toaster />
    </IconContext.Provider>
  );
}
