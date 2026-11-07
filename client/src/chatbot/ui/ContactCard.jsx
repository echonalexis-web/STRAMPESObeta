import { useTranslation } from 'react-i18next';
import { CONTACT, telHref, mailtoHref, facebookHref } from '../contact.js';

// Phone, email and Facebook only; values come from contact.js, never from KB text.
export default function ContactCard() {
  const { t } = useTranslation();
  return (
    <div className="cb-contact">
      <p className="cb-contact__title">{t('chatbot.contact.title')}</p>
      <ul className="cb-contact__list">
        <li>
          <a className="cb-contact__item" href={telHref()}>
            <span className="cb-contact__label">{t('chatbot.contact.call')}</span>
            <span className="cb-contact__value">{CONTACT.phone}</span>
          </a>
        </li>
        <li>
          <a className="cb-contact__item" href={mailtoHref()}>
            <span className="cb-contact__label">{t('chatbot.contact.email')}</span>
            <span className="cb-contact__value">{CONTACT.email}</span>
          </a>
        </li>
        <li>
          <a className="cb-contact__item" href={facebookHref()} target="_blank" rel="noopener noreferrer">
            <span className="cb-contact__label">{t('chatbot.contact.facebook')}</span>
            <span className="cb-contact__value">{CONTACT.facebook}</span>
          </a>
        </li>
      </ul>
    </div>
  );
}
