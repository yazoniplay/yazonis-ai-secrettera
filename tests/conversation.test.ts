import { describe, expect, it } from 'vitest';
import { advanceConversation, createConversation } from '../src/conversation.js';

describe('receptionist conversation', () => {
  it('collects a name, reason and callback choice in English', () => {
    let turn = createConversation('en');
    expect(turn.reply).toContain('May I have your name');
    turn = advanceConversation(turn.state, 'Alex');
    expect(turn.state.callerName).toBe('Alex');
    expect(turn.reply).toContain('How can I help');
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
    expect(turn.reply).toContain('complete phone number');
    turn = advanceConversation(turn.state, '+46701234567');
    expect(turn.completed).toBe(true);
    expect(turn.state.callerPhone).toBe('+46701234567');
    expect(turn.state.callbackRequested).toBe(true);
    expect(turn.reply).toContain('Yazoniii');
    expect(turn.reply).toContain('+46701234567');
    expect(turn.reply).not.toContain('Sam');
  });

  it('switches to Swedish when the caller speaks Swedish', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Jag heter Lina');
    expect(turn.state.language).toBe('sv');
    expect(turn.state.callerName).toBe('Lina');
    expect(turn.reply).toContain('Vad kan jag hjälpa dig med');
  });

  it('switches to Arabic when the caller uses Arabic script', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'أحمد');
    expect(turn.state.language).toBe('ar');
    expect(turn.reply).toContain('كيف يمكنني مساعدتك');
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
