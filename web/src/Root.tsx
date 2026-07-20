import { useEffect, useState } from "react";
import LoginPage from "./LoginPage";
import PowerPage from "./PowerPage";
import { checkSession } from "./api";

type Screen = "checking" | "login" | "power";

export default function Root() {
  const [screen, setScreen] = useState<Screen>("checking");

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

  if (screen === "checking") return null;
  return screen === "login" ? <LoginPage /> : <PowerPage />;
}
