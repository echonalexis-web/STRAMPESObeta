import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthContext } from '../../context/AuthContext.jsx';
import { mapUserToChatContext, ctxKeyOf } from './chatContextFromUser.js';

export function useChatContext() {
  const auth = useContext(AuthContext);
  const { i18n } = useTranslation();
  const user = auth ? auth.user : null;
  const loading = auth ? auth.loading : true;
  const language = i18n.language;
  return useMemo(() => {
    const ctx = mapUserToChatContext(user, language);
    return { ...ctx, ctxKey: ctxKeyOf(ctx), ready: !loading };
  }, [user, language, loading]);
}
