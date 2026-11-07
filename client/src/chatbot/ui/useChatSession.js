import { useReducer, useEffect, useCallback } from 'react';
import { buildIndex, ask } from '../engine/index.js';
import { ALL_ENTRIES } from '../kb/index.js';
import { chatReducer, initialState } from './chatReducer.js';

const index = buildIndex(ALL_ENTRIES);
const MAX_INPUT = 200;

export function useChatSession(ctx) {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const ctxKey = ctx.ctxKey;

  useEffect(() => {
    dispatch({ type: 'reset' });
  }, [ctxKey]);

  const send = useCallback(
    (raw) => {
      const text = String(raw ?? '').slice(0, MAX_INPUT);
      if (!text.trim()) return;
      let result;
      try {
        result = ask(index, text, ctx);
      } catch {
        result = { type: 'fallback' };
      }
      dispatch({ type: 'send', text, result });
    },
    [ctx],
  );

  const pickChip = useCallback((entryId) => dispatch({ type: 'chip', entryId }), []);
  const reset = useCallback(() => dispatch({ type: 'reset' }), []);

  return { messages: state.messages, send, pickChip, reset };
}
