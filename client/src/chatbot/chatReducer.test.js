import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatReducer, initialState, MAX_MESSAGES } from './ui/chatReducer.js';

const ans = { type: 'answer', entryId: 'a1' };
const send = (s, text, result = ans) => chatReducer(s, { type: 'send', text, result });

test('send appends user then bot message with result', () => {
  const s = send(initialState, 'hello');
  assert.equal(s.messages.length, 2);
  assert.deepEqual(s.messages[0], { id: 1, from: 'user', text: 'hello' });
  assert.deepEqual(s.messages[1], { id: 2, from: 'bot', result: ans });
  assert.equal(s.messages[1].text, undefined);
});

test('ids are monotonic across send and chip', () => {
  let s = send(initialState, 'a');
  s = chatReducer(s, { type: 'chip', entryId: 'x' });
  s = send(s, 'b');
  assert.deepEqual(s.messages.map((m) => m.id), [1, 2, 3, 4, 5]);
});

test('chip appends bot answer result only', () => {
  const s = chatReducer(initialState, { type: 'chip', entryId: 'e9' });
  assert.deepEqual(s.messages, [{ id: 1, from: 'bot', result: { type: 'answer', entryId: 'e9' } }]);
});

test('cap at 50 drops oldest', () => {
  let s = initialState;
  for (let i = 0; i < 40; i++) s = send(s, 'msg ' + i);
  assert.equal(s.messages.length, MAX_MESSAGES);
  assert.equal(s.messages[s.messages.length - 2].text, 'msg 39');
  assert.equal(s.messages[0].id, 31);
});

test('third identical consecutive send gets repeat', () => {
  let s = send(initialState, 'Resume');
  s = send(s, '  resume ');
  assert.deepEqual(s.messages[3].result, ans);
  s = send(s, 'RESUME');
  assert.deepEqual(s.messages[5].result, { type: 'repeat' });
  assert.equal(s.messages[4].text, 'RESUME');
});

test('different text breaks the streak', () => {
  let s = send(initialState, 'a');
  s = send(s, 'a');
  s = send(s, 'b');
  s = send(s, 'a');
  assert.deepEqual(s.messages[7].result, ans);
});

test('whitespace is collapsed for repeat detection', () => {
  let s = send(initialState, 'how  do i');
  s = send(s, 'how do   i');
  s = send(s, ' HOW DO I ');
  assert.equal(s.messages[5].result.type, 'repeat');
});

test('empty result does not count toward repeats', () => {
  const empty = { type: 'empty' };
  let s = initialState;
  for (let i = 0; i < 4; i++) s = send(s, '???', empty);
  assert.ok(s.messages.filter((m) => m.from === 'bot').every((m) => m.result.type === 'empty'));
});

test('reset clears everything including ids and streak', () => {
  let s = send(initialState, 'a');
  s = send(s, 'a');
  s = chatReducer(s, { type: 'reset' });
  assert.deepEqual(s.messages, []);
  s = send(s, 'a');
  assert.equal(s.messages[0].id, 1);
  assert.deepEqual(s.messages[1].result, ans);
});

test('reducer is immutable', () => {
  const before = send(initialState, 'a');
  const snapshot = JSON.stringify(before);
  const msgs = before.messages;
  send(before, 'b');
  chatReducer(before, { type: 'chip', entryId: 'z' });
  assert.equal(JSON.stringify(before), snapshot);
  assert.equal(before.messages, msgs);
  assert.deepEqual(initialState.messages, []);
});

test('markup text kept as plain string', () => {
  const s = send(initialState, '<img onerror=x>');
  assert.equal(s.messages[0].text, '<img onerror=x>');
});
