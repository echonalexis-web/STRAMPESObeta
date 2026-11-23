import PropTypes from "prop-types";
import { FaCheckCircle, FaExclamationCircle } from "react-icons/fa";

// The last step of the applying flow: what will be saved, with a way back to each document. The one
// primary button (Continue to submit application) is in the sticky bar above, so there is never a
// second primary on the page.
function Row({ label, children }) {
  return (
    <div className="stu-review__row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
Row.propTypes = { label: PropTypes.string.isRequired, children: PropTypes.node };

function Check({ ok, children }) {
  const Icon = ok ? FaCheckCircle : FaExclamationCircle;
  return (
    <li className={`stu-check${ok ? " is-ok" : " is-bad"}`}>
      <Icon aria-hidden="true" />
      <span>{children}</span>
    </li>
  );
}
Check.propTypes = { ok: PropTypes.bool, children: PropTypes.node };

export default function ReviewStep({ t, resume, letter, ready, onEdit }) {
  return (
    <section className="stu-review" aria-labelledby="stu-review-title">
      <h2 className="stu-review__title" id="stu-review-title">
        {t("studio.review.heading")}
      </h2>
      <div className="stu-review__cards">
        <article className="stu-card" aria-labelledby="stu-review-resume">
          <h3 className="stu-card__title" id="stu-review-resume">
            {t("studio.review.resume")}
          </h3>
          <dl className="stu-review__list">
            <Row label={t("studio.review.type")}>{resume.typeLabel}</Row>
            <Row label={t("studio.review.look")}>{resume.lookLabel}</Row>
            <Row label={t("studio.review.photo")}>{resume.photoShown ? t("studio.review.photoShown") : t("studio.review.photoHidden")}</Row>
            <Row label={t("studio.review.savedAs")}>{resume.title}</Row>
          </dl>
          <button type="button" className="stu-btn stu-btn--secondary" onClick={() => onEdit("resume")}>
            {t("studio.review.editResume")}
          </button>
        </article>

        <article className="stu-card" aria-labelledby="stu-review-letter">
          <h3 className="stu-card__title" id="stu-review-letter">
            {t("studio.review.letter")}
          </h3>
          <dl className="stu-review__list">
            <Row label={t("studio.review.salutation")}>{letter.salutation}</Row>
            <Row label={t("studio.review.jobEmployer")}>{letter.jobEmployer}</Row>
            <Row label={t("studio.review.tone")}>{letter.toneLabel}</Row>
            <Row label={t("studio.review.savedAs")}>{letter.title}</Row>
          </dl>
          <p className="stu-help">{letter.addressedNote}</p>
          <p className="stu-help">
            {letter.noBrackets ? t("studio.review.noBrackets") : null}
          </p>
          <button type="button" className="stu-btn stu-btn--secondary" onClick={() => onEdit("coverLetter")}>
            {t("studio.review.editLetter")}
          </button>
        </article>
      </div>

      <article className="stu-card stu-card--wide" aria-labelledby="stu-review-before">
        <h3 className="stu-card__title" id="stu-review-before">
          {t("studio.review.before")}
        </h3>
        <ul className="stu-checks">
          <Check ok={ready.resume}>{t("studio.review.checkResume")}</Check>
          <Check ok={ready.letter}>{t("studio.review.checkLetter")}</Check>
          <Check ok>{t("studio.review.checkSaved")}</Check>
        </ul>
        <p className="stu-help">{t("studio.review.nothingSent")}</p>
      </article>
    </section>
  );
}

ReviewStep.propTypes = {
  t: PropTypes.func.isRequired,
  resume: PropTypes.shape({
    typeLabel: PropTypes.string,
    lookLabel: PropTypes.string,
    photoShown: PropTypes.bool,
    title: PropTypes.string,
  }).isRequired,
  letter: PropTypes.shape({
    salutation: PropTypes.string,
    jobEmployer: PropTypes.string,
    toneLabel: PropTypes.string,
    title: PropTypes.string,
    addressedNote: PropTypes.string,
    noBrackets: PropTypes.bool,
  }).isRequired,
  ready: PropTypes.shape({ resume: PropTypes.bool, letter: PropTypes.bool }).isRequired,
  onEdit: PropTypes.func.isRequired,
};
