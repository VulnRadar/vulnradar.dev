"use client";

import { useEffect, useState } from "react";

/**
 * Whether the browser currently believes it has a network connection.
 *
 * Nothing in the product used to know it was offline, so every screen guessed
 * at what a failed fetch meant and the guesses disagreed: History rendered
 * "no scans recorded yet", the notification bell rendered "all caught up",
 * the Developer tab rendered "you have no API keys". Losing wifi told the
 * user their data was gone. One shared signal lets those surfaces say
 * "can't reach the server" instead.
 *
 * Starts optimistic (`true`) so server and first client render agree; the
 * effect corrects it immediately on mount. `navigator.onLine` is only
 * authoritative in the negative direction (false really does mean no
 * connection; true only means an interface is up), which is exactly the
 * direction this is used in.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  return online;
}
