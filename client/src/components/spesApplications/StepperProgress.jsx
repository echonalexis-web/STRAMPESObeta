import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { SPES_STAGE_KEYS, spesStageIndex } from "../../utils/spesSlots";

// Full tracker: five steps, circles on one row joined by connector lines, labels under the
// circles. The connectors are separate elements in the circle row, so a line can never run
// through a label. Class names are spes-prog* (the older .spes-stepper* names in spes.css
// belong to the previous layout).
export function StepperProgress({ status }) {
  const { t } = useTranslation();
  const active = spesStageIndex(status);
  const last = SPES_STAGE_KEYS.length - 1;
  return (
    <ol className="spes-prog" aria-label={t("spes.tracker.label")}>
      {SPES_STAGE_KEYS.map((key, i) => {
        const state = i < active ? "done" : i === active ? "current" : "upcoming";
        return (
          <li key={key} className={`spes-prog__step spes-prog__step--${state}`} aria-current={state === "current" ? "step" : undefined}>
            <span className="spes-prog__track" aria-hidden="true">
              <span className={`spes-prog__line${i === 0 ? " is-hidden" : i <= active ? " is-done" : ""}`} />
              <span className="spes-prog__dot">{state === "done" ? <Check size={16} strokeWidth={3} /> : i + 1}</span>
              <span className={`spes-prog__line${i === last ? " is-hidden" : i < active ? " is-done" : ""}`} />
            </span>
            <span className="spes-prog__label">{t(`spes.stage.${key}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}

// Compact indicator for the collapsed row: a five-segment bar plus the current step name.
export function MiniProgress({ status }) {
  const { t } = useTranslation();
  const active = spesStageIndex(status);
  const key = SPES_STAGE_KEYS[Math.min(active, SPES_STAGE_KEYS.length - 1)];
  const text = t("spes.my.progressText", { current: active + 1, total: SPES_STAGE_KEYS.length, step: t(`spes.stage.${key}`) });
  return (
    <span className="spes-mini">
      <span className="spes-mini__bar" aria-hidden="true">
        {SPES_STAGE_KEYS.map((k, i) => (
          <Fragment key={k}>
            <span className={`spes-mini__seg${i < active ? " is-done" : i === active ? " is-current" : ""}`} />
          </Fragment>
        ))}
      </span>
      <span className="spes-mini__text">{t(`spes.stage.${key}`)}</span>
      <span className="ds-sr-only">{text}</span>
    </span>
  );
}
