import { describe, expect, it } from 'vitest';
import { advanceConversation, createConversation } from '../src/conversation.js';

describe('receptionist conversation', () => {
  it('collects a name, reason and callback choice in English', () => {
    let turn = createConversation('en');
    expect(turn.reply).toContain('Who am I speaking with?');
    turn = advanceConversation(turn.state, 'Alex');
    expect(turn.state.callerName).toBe('Alex');
    expect(turn.reply).toContain('What can I help you with?');
    turn = advanceConversation(turn.state, 'I need to book an appointment');
    expect(turn.state.intent).toBe('appointment');
    expect(turn.state.message).toContain('book an appointment');
    turn = advanceConversation(turn.state, 'No');
    expect(turn.completed).toBe(true);
    expect(turn.state.stage).toBe('complete');
  });

  it('asks for a callback number and validates it', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Sam');
    turn = advanceConversation(turn.state, 'Please ask them to call me');
    expect(turn.reply).toContain('Yazoniii');
    turn = advanceConversation(turn.state, 'Yes');
    expect(turn.state.stage).toBe('phone');
    expect(turn.reply).toContain('Yazoniii');
    turn = advanceConversation(turn.state, '123');
    expect(turn.state.stage).toBe('phone');
    expect(turn.reply).toContain('complete number');
    turn = advanceConversation(turn.state, '+46701234567');
    expect(turn.completed).toBe(true);
    expect(turn.state.callerPhone).toBe('+46701234567');
    expect(turn.state.callbackRequested).toBe(true);
    expect(turn.reply).toContain('Yazoniii');
    expect(turn.reply).toContain('+46701234567');
    expect(turn.reply).toContain('Sam');
  });


  it('uses incoming caller ID automatically and never asks the caller to repeat it', () => {
    let turn = createConversation('en', '+46701234567');
    expect(turn.state.callerPhone).toBe('+46701234567');
    turn = advanceConversation(turn.state, 'Morgan');
    turn = advanceConversation(turn.state, 'I need to discuss my appointment');
    expect(turn.reply).toContain('call you back on this number');
    turn = advanceConversation(turn.state, 'Yes');
    expect(turn.completed).toBe(true);
    expect(turn.state.stage).toBe('complete');
    expect(turn.state.callerPhone).toBe('+46701234567');
    expect(turn.reply).toContain('Yazoniii');
    expect(turn.reply).toContain('+46701234567');
    expect(turn.reply).not.toContain('What number');
  });

  it('switches to Swedish when the caller speaks Swedish', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Jag heter Lina');
    expect(turn.state.language).toBe('sv');
    expect(turn.state.callerName).toBe('Lina');
    expect(turn.reply).toContain('Vad gäller det?');
  });

  it('switches to Arabic when the caller uses Arabic script', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'أحمد');
    expect(turn.state.language).toBe('ar');
    expect(turn.reply).toContain('كيف يمكنني مساعدتك');
  });

  it('marks urgent family messages and tells the caller what will be passed on', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Morgan');
    turn = advanceConversation(turn.state, 'My mom needs to speak to Yazoniii immediately.');
    expect(turn.state.priority).toBe('urgent');
    expect(turn.reply).toContain('flag this as urgent');
    turn = advanceConversation(turn.state, 'No');
    expect(turn.completed).toBe(true);
    expect(turn.reply).toContain('your name and the reason for your call');
    expect(turn.reply).toContain('marked the message urgent');
  });

  it('marks explicit emergencies as urgent', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Taylor');
    turn = advanceConversation(turn.state, 'This is an emergency, please call me now.');
    expect(turn.state.priority).toBe('urgent');
  });

  it('keeps ordinary family mentions non-urgent without a request for immediate attention', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Taylor');
    turn = advanceConversation(turn.state, 'My mom asked about the opening hours.');
    expect(turn.state.priority).toBe('normal');
  });

  it('does not complete on an ambiguous callback answer', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Taylor');
    turn = advanceConversation(turn.state, 'I have a question');
    turn = advanceConversation(turn.state, 'Maybe');
    expect(turn.completed).toBe(false);
    expect(turn.state.stage).toBe('callback');
  });
});
