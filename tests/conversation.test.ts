import { describe, expect, it } from 'vitest';
import { advanceConversation, createConversation, isNoResponse } from '../src/conversation.js';

describe('receptionist conversation', () => {
  it('extracts a caller name from a natural greeting', () => {
    const turn = advanceConversation(createConversation('en').state, "Hi, I'm Alex.");
    expect(turn.state.callerName).toBe('Alex');
    expect(turn.reply).toBe('Thanks, Alex. What can I help you with?');
  });

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
    expect(turn.completed).toBe(false);
    expect(turn.state.stage).toBe('anything_else');
    turn = advanceConversation(turn.state, "No, that's everything. Thank you.");
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
    expect(turn.completed).toBe(false);
    expect(turn.state.stage).toBe('anything_else');
    turn = advanceConversation(turn.state, 'No, that is all. Thanks.');
    expect(turn.completed).toBe(true);
    expect(turn.state.callerPhone).toBe('+46701234567');
    expect(turn.state.callbackRequested).toBe(true);
    expect(turn.reply).toContain('Yazoniii');
    expect(turn.reply).toContain('+46701234567');
    expect(turn.reply).toContain('Sam');
  });


  it('extracts Swedish phone numbers from natural language replies', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Alex');
    turn = advanceConversation(turn.state, 'I need help with an appointment');
    turn = advanceConversation(turn.state, 'Yes, please call me back');
    turn = advanceConversation(turn.state, 'My number is 070 123 45 67.');
    expect(turn.state.callerPhone).toBe('0701234567');
    expect(turn.state.stage).toBe('anything_else');

    let international = createConversation('en');
    international = advanceConversation(international.state, 'Alex');
    international = advanceConversation(international.state, 'I need help with an appointment');
    international = advanceConversation(international.state, 'Yes, please call me back');
    international = advanceConversation(international.state, 'My number is +46707358046');
    expect(international.state.callerPhone).toBe('+46707358046');
    expect(international.state.stage).toBe('anything_else');
  });

  it('uses incoming caller ID automatically and never asks the caller to repeat it', () => {
    let turn = createConversation('en', '+46701234567');
    expect(turn.state.callerPhone).toBe('+46701234567');
    turn = advanceConversation(turn.state, 'Morgan');
    turn = advanceConversation(turn.state, 'I need to discuss my appointment');
    expect(turn.reply).toContain('call you back on this number');
    turn = advanceConversation(turn.state, 'Yes');
    expect(turn.completed).toBe(false);
    expect(turn.state.stage).toBe('anything_else');
    turn = advanceConversation(turn.state, 'No');
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
    expect(turn.completed).toBe(false);
    turn = advanceConversation(turn.state, 'No');
    expect(turn.completed).toBe(true);
    expect(turn.reply).toContain('Here is exactly what I will send Yazoniii:');
    expect(turn.reply).toContain('Callback: Not requested');
    expect(turn.reply).toContain('Priority: URGENT');
  });

  it.each(['I am his mom', "It's his dad calling", "I'm Yazoniii's sister", 'This is your brother'])(
    'flags a caller identifying as close family: %s',
    identity => {
      const turn = advanceConversation(createConversation('en').state, identity);
      expect(turn.state.priority).toBe('urgent');
      expect(turn.state.callerName).toBe('Yazoniii family member');
    }
  );

  it('reads back the exact recorded details before ending', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Alex');
    turn = advanceConversation(turn.state, 'Please call me about the appointment tomorrow.');
    turn = advanceConversation(turn.state, 'No');
    expect(turn.completed).toBe(false);
    turn = advanceConversation(turn.state, 'No');
    expect(turn.reply).toContain('Caller: Alex');
    expect(turn.reply).toContain('Message: Please call me about the appointment tomorrow.');
    expect(turn.reply).toContain('Callback: Not requested');
    expect(turn.reply).toContain('Priority: Normal');
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


  it.each([
    "No, that's everything. Thank you.",
    "No, that's all. Thanks.",
    "No, that is everything.",
    "No thanks.",
    "That's it, thank you.",
    "Nothing else."
  ])('recognizes a clear polite ending: %s', phrase => {
    expect(isNoResponse(phrase)).toBe(true);
  });

  it('does not treat a refusal followed by another detail as a final no', () => {
    expect(isNoResponse('No, but I forgot to mention something.')).toBe(false);
  });

  it('completes immediately after the caller declines to add anything else', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Alex');
    turn = advanceConversation(turn.state, 'I have a problem with an appointment.');
    expect(turn.state.stage).toBe('reason');
    expect(turn.reply).toContain('What went wrong');
    turn = advanceConversation(turn.state, 'It was supposed to be tomorrow, but I think something went wrong.');
    expect(turn.state.stage).toBe('reason');
    expect(turn.reply).toContain('What specifically went wrong');
    turn = advanceConversation(turn.state, 'Actually, sorry, I meant Thursday, not tomorrow.');
    expect(turn.state.message).toContain('Thursday');
    expect(turn.state.message).not.toContain('tomorrow');
    expect(turn.state.stage).toBe('reason');
    expect(turn.reply).toContain('What specifically went wrong');
    turn = advanceConversation(turn.state, 'The appointment time was changed without telling me.');
    expect(turn.state.stage).toBe('callback');
    turn = advanceConversation(turn.state, 'Could you ask Yazoniii to call me back after 3 PM?');
    expect(turn.state.stage).toBe('phone');
    turn = advanceConversation(turn.state, '070 123 45 67');
    expect(turn.state.stage).toBe('anything_else');
    turn = advanceConversation(turn.state, "No, that's everything. Thank you.");
    expect(turn.completed).toBe(true);
    expect(turn.state.stage).toBe('complete');
    expect(turn.reply).toContain('0701234567');
    expect(turn.reply).toContain('preferred time: 3 PM');
  });

  it('includes a caller preferred callback time in the final read-back', () => {
    let turn = createConversation('en');
    turn = advanceConversation(turn.state, 'Alex');
    turn = advanceConversation(turn.state, 'My appointment was cancelled.');
    turn = advanceConversation(turn.state, 'Please call me back after 3 PM.');
    turn = advanceConversation(turn.state, '070 123 45 67');
    turn = advanceConversation(turn.state, "No, that's everything.");
    expect(turn.completed).toBe(true);
    expect(turn.reply).toContain('Callback: Requested (preferred time: 3 PM)');
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
