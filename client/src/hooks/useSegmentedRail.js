import { useEffect, useRef } from "react";
import { railFits, segmentPositions } from "../utils/segmentedRail";
import "../styles/segmented-rail.css";

// One shared behaviour for every single-select pill rail. Put the returned ref and the
// `seg-rail` class on the element that holds the pills:
//
//   const railRef = useSegmentedRail();
//   <div ref={railRef} className="my-rail seg-rail" role="tablist"> ...pills... </div>
//
// It tags each visible pill with data-seg-pos (first / middle / last / single) and decides
// whether the joined shape fits on one row: data-segmented="joined" when it does,
// "separate" when it does not (the rail then keeps its own separated pills). It re-checks
// when the window, the rail or its pills change size, or when pills are added or removed.
// Nothing else about the rail changes: labels, state, roles and keyboard stay with the page.
const isVisible = (el) => el.offsetParent !== null || el.getClientRects().length > 0;

export default function useSegmentedRail() {
  const ref = useRef(null);

  useEffect(() => {
    const rail = ref.current;
    if (!rail) return undefined;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const pills = Array.from(rail.children).filter(isVisible);
      const positions = segmentPositions(pills.length);
      Array.from(rail.children).forEach((child) => child.removeAttribute("data-seg-pos"));
      pills.forEach((pill, index) => pill.setAttribute("data-seg-pos", positions[index]));

      // Try the joined shape, then keep it only if it fits on one row.
      rail.setAttribute("data-segmented", "joined");
      const fits = railFits({
        scrollWidth: rail.scrollWidth,
        clientWidth: rail.clientWidth,
        parentWidth: rail.parentElement ? rail.parentElement.clientWidth : 0,
      });
      rail.setAttribute("data-segmented", fits ? "joined" : "separate");
    };

    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    apply();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    if (resize) {
      resize.observe(rail);
      if (rail.parentElement) resize.observe(rail.parentElement);
      Array.from(rail.children).forEach((child) => resize.observe(child));
    }
    const mutation = typeof MutationObserver === "undefined" ? null : new MutationObserver(() => {
      if (resize) {
        resize.disconnect();
        resize.observe(rail);
        if (rail.parentElement) resize.observe(rail.parentElement);
        Array.from(rail.children).forEach((child) => resize.observe(child));
      }
      schedule();
    });
    if (mutation) mutation.observe(rail, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", schedule);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (resize) resize.disconnect();
      if (mutation) mutation.disconnect();
      window.removeEventListener("resize", schedule);
      rail.removeAttribute("data-segmented");
      Array.from(rail.children).forEach((child) => child.removeAttribute("data-seg-pos"));
    };
  }, []);

  return ref;
}
