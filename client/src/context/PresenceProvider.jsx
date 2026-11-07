import { useCallback, useEffect, useMemo, useState } from "react";
import { useSocket } from "./SocketContext";
import { PresenceContext } from "./presenceContext";
import { ACTIVE_STATUS, PRESENCE_EVENTS } from "../utils/activeStatus";

// Holds what the server says about the people the user can message:
// userId -> { state: "active" | "inactive", lastActiveAt }. Hidden users are
// simply absent. The server decides who is visible; the client never filters
// on its own. If the socket is unavailable the map stays empty and nothing is
// shown, which is how the app behaved before.
export default function PresenceProvider({ children }) {
  const { socket, isConnected } = useSocket();
  const [statuses, setStatuses] = useState({});
  const [now, setNow] = useState(() => Date.now());

  // Re-render labels every minute without refetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ACTIVE_STATUS.LABEL_REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!socket) return undefined;

    const onChanged = (payload) => {
      if (!payload || typeof payload.userId !== "string") return;
      setStatuses((prev) => {
        const next = { ...prev };
        if (payload.state === "active" || payload.state === "inactive") {
          next[payload.userId] = { state: payload.state, lastActiveAt: payload.lastActiveAt || null };
        } else {
          delete next[payload.userId]; // hidden: forget them
        }
        return next;
      });
    };

    const onSnapshot = (payload) => {
      const next = {};
      for (const entry of Array.isArray(payload?.users) ? payload.users : []) {
        if (entry && typeof entry.userId === "string" && (entry.state === "active" || entry.state === "inactive")) {
          next[entry.userId] = { state: entry.state, lastActiveAt: entry.lastActiveAt || null };
        }
      }
      setStatuses(next);
      setNow(Date.now());
    };

    const onReset = () => setStatuses({});

    socket.on(PRESENCE_EVENTS.CHANGED, onChanged);
    socket.on(PRESENCE_EVENTS.SNAPSHOT, onSnapshot);
    socket.on(PRESENCE_EVENTS.RESET, onReset);
    return () => {
      socket.off(PRESENCE_EVENTS.CHANGED, onChanged);
      socket.off(PRESENCE_EVENTS.SNAPSHOT, onSnapshot);
      socket.off(PRESENCE_EVENTS.RESET, onReset);
    };
  }, [socket]);

  const refreshSnapshot = useCallback(() => {
    if (socket && socket.connected) socket.emit(PRESENCE_EVENTS.SNAPSHOT_REQUEST);
  }, [socket]);

  // One snapshot whenever we (re)connect: not one request per conversation.
  useEffect(() => {
    if (socket && isConnected) socket.emit(PRESENCE_EVENTS.SNAPSHOT_REQUEST);
  }, [socket, isConnected]);

  const value = useMemo(() => ({ statuses, now, refreshSnapshot }), [statuses, now, refreshSnapshot]);

  return <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>;
}
