import { useContext, useEffect } from "react";
import { AuthContext } from "../context/AuthContext";
import { useSocket } from "../context/SocketContext";
import { ACTIVE_STATUS, PRESENCE_EVENTS } from "../utils/activeStatus";

// Reports real activity to the server so "active now" means a person is
// actually using the app, not merely that a socket is open.
//
//   - interaction (mouse, keys, click, touch, scroll) or the tab becoming
//     visible again counts as activity; listeners are passive and cleaned up;
//   - a hidden tab stops counting after HIDDEN_IDLE_DELAY_MS;
//   - no interaction for IDLE_AFTER_MS means idle;
//   - while active a heartbeat goes out every HEARTBEAT_MS, and repeated
//     "active" messages are throttled to one per ACTIVITY_THROTTLE_MS; a
//     change of state is sent at once.
// The server also expires the user by itself if these messages stop, so a
// frozen tab cannot stay "active". It always reports; whether others see it
// is decided on the server from the user's privacy setting.
export default function ActiveStatusReporter() {
  const { user } = useContext(AuthContext);
  const { socket, isConnected } = useSocket();
  const userId = user?._id || user?.id;

  useEffect(() => {
    if (!socket || !isConnected || !userId) return undefined;

    let lastInteractionAt = Date.now(); // opening the app counts
    let lastSentState = null;
    let lastSentAt = 0;
    let hiddenTimer = null;

    const currentState = () =>
      document.visibilityState === "visible" && Date.now() - lastInteractionAt < ACTIVE_STATUS.IDLE_AFTER_MS ? "active" : "idle";

    const send = (state) => {
      if (!socket.connected) return;
      const now = Date.now();
      // Same state again: only as a throttled heartbeat.
      if (state === lastSentState && now - lastSentAt < ACTIVE_STATUS.ACTIVITY_THROTTLE_MS) return;
      lastSentState = state;
      lastSentAt = now;
      socket.emit(PRESENCE_EVENTS.UPDATE, { state });
    };

    const onInteraction = () => {
      lastInteractionAt = Date.now();
      if (document.visibilityState === "visible") send("active");
    };

    const onVisibility = () => {
      if (hiddenTimer) {
        window.clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      if (document.visibilityState === "visible") {
        onInteraction(); // coming back to the tab is activity
      } else {
        hiddenTimer = window.setTimeout(() => send("idle"), ACTIVE_STATUS.HIDDEN_IDLE_DELAY_MS);
      }
    };

    const heartbeat = window.setInterval(() => send(currentState()), ACTIVE_STATUS.HEARTBEAT_MS);

    const options = { passive: true, capture: true }; // capture: scroll does not bubble
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll", "wheel"];
    events.forEach((name) => window.addEventListener(name, onInteraction, options));
    document.addEventListener("visibilitychange", onVisibility);

    send(currentState()); // right after (re)connecting

    return () => {
      events.forEach((name) => window.removeEventListener(name, onInteraction, options));
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(heartbeat);
      if (hiddenTimer) window.clearTimeout(hiddenTimer);
    };
  }, [socket, isConnected, userId]);

  return null;
}
