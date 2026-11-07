import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ALL_ENTRIES } from '../kb/index.js';
import { getRoute } from '../routes/registry.js';
import { resolveLink } from '../routes/resolveLink.js';
import { startersFor } from './starters.js';
import { pickText, pickSteps, paragraphs, isVisibleTo } from './localized.js';
import ContactCard from './ContactCard.jsx';

const ENTRY_BY_ID = new Map(ALL_ENTRIES.map((e) => [e.id, e]));

function Paragraphs({ text, english }) {
  const { t } = useTranslation();
  const parts = paragraphs(text);
  return parts.map((p, i) => (
    <p key={i} className="cb-p">
      {p}
      {english && i === parts.length - 1 ? ` ${t('chatbot.englishTag')}` : ''}
    </p>
  ));
}

export function Chips({ ids, ctx, onPick }) {
  const { t } = useTranslation();
  const chips = ids.map((id) => ENTRY_BY_ID.get(id)).filter((e) => isVisibleTo(e, ctx.role));
  if (!chips.length) return null;
  return (
    <div className="cb-chips">
      {chips.map((e) => {
        const q = pickText(e.q, ctx.locale);
        return (
          <button key={e.id} type="button" className="cb-chip" onClick={() => onPick(e.id)}>
            {q.text}
            {q.english ? ` ${t('chatbot.englishTag')}` : ''}
          </button>
        );
      })}
    </div>
  );
}

function RouteLink({ routeId, path, onNavigate }) {
  const { t } = useTranslation();
  const route = getRoute(routeId);
  return (
    <Link className="cb-link" to={path} onClick={onNavigate}>
      {t(route.labelKey)}
      <span className="cb-link__arrow" aria-hidden="true">→</span>
    </Link>
  );
}

function Targets({ entry, ctx, onNavigate }) {
  const { t } = useTranslation();
  const ids = [entry.target, ...(entry.targets || [])].filter(Boolean);
  const nodes = ids.map((id) => {
    const r = resolveLink(id, ctx);
    if (r.kind === 'link') {
      return <RouteLink key={id} routeId={id} path={r.path} onNavigate={onNavigate} />;
    }
    if (r.kind === 'login') {
      return (
        <Link key={id} className="cb-link" to="/login" onClick={onNavigate}>
          {t('chatbot.logInFirst')}
          <span className="cb-link__arrow" aria-hidden="true">→</span>
        </Link>
      );
    }
    if (r.kind === 'blocked') {
      return (
        <div key={id} className="cb-blocked">
          <p className="cb-p">{t(`chatbot.blocked.${r.reason}`)}</p>
          {r.alternative && r.alternative.kind === 'link' ? (
            <RouteLink routeId={r.alternative.routeId} path={r.alternative.path} onNavigate={onNavigate} />
          ) : null}
        </div>
      );
    }
    return null;
  });
  return nodes.some(Boolean) ? <div className="cb-links">{nodes}</div> : null;
}

function Answer({ entry, ctx, onPick, onNavigate }) {
  const { t } = useTranslation();
  const a = pickText(entry.a, ctx.locale);
  const steps = pickSteps(entry.steps, ctx.locale);
  return (
    <>
      <Paragraphs text={a.text} english={a.english} />
      {steps.items.length ? (
        <ol className="cb-steps">
          {steps.items.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : null}
      <Targets entry={entry} ctx={ctx} onNavigate={onNavigate} />
      {entry.contact ? <ContactCard /> : null}
      {entry.followUps && entry.followUps.length ? (
        <div className="cb-related">
          <p className="cb-related__label">{t('chatbot.related')}</p>
          <Chips ids={entry.followUps} ctx={ctx} onPick={onPick} />
        </div>
      ) : null}
    </>
  );
}

function Fallback({ ctx, onPick }) {
  const { t } = useTranslation();
  return (
    <>
      <p className="cb-p">{t('chatbot.fallback')}</p>
      <ContactCard />
      <p className="cb-related__label">{t('chatbot.tryAsking')}</p>
      <Chips ids={startersFor(ctx.role)} ctx={ctx} onPick={onPick} />
    </>
  );
}

export default function BotMessage({ result, ctx, onPick, onNavigate }) {
  const { t } = useTranslation();
  const r = result || { type: 'fallback' };
  switch (r.type) {
    case 'answer': {
      const entry = ENTRY_BY_ID.get(r.entryId);
      if (!isVisibleTo(entry, ctx.role)) return <Fallback ctx={ctx} onPick={onPick} />;
      return <Answer entry={entry} ctx={ctx} onPick={onPick} onNavigate={onNavigate} />;
    }
    case 'suggest':
      return (
        <>
          <p className="cb-p">{t('chatbot.didYouMean')}</p>
          <Chips ids={r.entryIds} ctx={ctx} onPick={onPick} />
          <p className="cb-related__label">{t('chatbot.noneOfThese')}</p>
          <ContactCard />
        </>
      );
    case 'empty':
      return <p className="cb-p">{t('chatbot.empty')}</p>;
    case 'repeat':
      return <p className="cb-p">{t('chatbot.repeat')}</p>;
    case 'refusal':
      return (
        <>
          <p className="cb-p">
            {t(`chatbot.refusal.${r.reason}`, { defaultValue: t('chatbot.refusal.general') })}
          </p>
          {r.reason === 'legal' ? <ContactCard /> : null}
        </>
      );
    default:
      return <Fallback ctx={ctx} onPick={onPick} />;
  }
}
