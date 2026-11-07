// Pure session reducer: no react, no engine calls. The hook computes `result`.
export const MAX_MESSAGES = 50;

export const initialState = Object.freeze({
  messages: [],
  nextId: 1,
  lastKey: null,
  repeatCount: 0,
});

const normalizeKey = (text) => String(text).trim().toLowerCase().replace(/\s+/g, ' ');

const append = (messages, added) => {
  const all = [...messages, ...added];
  return all.length > MAX_MESSAGES ? all.slice(all.length - MAX_MESSAGES) : all;
};

export function chatReducer(state = initialState, action) {
  switch (action.type) {
    case 'send': {
      const text = String(action.text ?? '');
      const result = action.result || { type: 'fallback' };
      const isEmpty = result.type === 'empty';
      const key = normalizeKey(text);
      let lastKey = state.lastKey;
      let repeatCount = state.repeatCount;
      let botResult = result;
      if (!isEmpty) {
        repeatCount = key === state.lastKey ? state.repeatCount + 1 : 1;
        lastKey = key;
        if (repeatCount >= 3) botResult = { type: 'repeat' };
      }
      const userMsg = { id: state.nextId, from: 'user', text };
      const botMsg = { id: state.nextId + 1, from: 'bot', result: botResult };
      return {
        messages: append(state.messages, [userMsg, botMsg]),
        nextId: state.nextId + 2,
        lastKey,
        repeatCount,
      };
    }
    case 'chip': {
      const botMsg = {
        id: state.nextId,
        from: 'bot',
        result: { type: 'answer', entryId: action.entryId },
      };
      return {
        messages: append(state.messages, [botMsg]),
        nextId: state.nextId + 1,
        lastKey: null,
        repeatCount: 0,
      };
    }
    case 'reset':
      return initialState;
    default:
      return state;
  }
}
