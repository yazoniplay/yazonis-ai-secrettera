import { detectLanguage, type SupportedLanguage } from './language.js';

export type ConversationStage = 'name' | 'reason' | 'callback' | 'phone' | 'complete';
export interface ConversationState {
  priority: 'normal' | 'urgent';
  language: SupportedLanguage;
  stage: ConversationStage;
  callerName: string | null;
  callerPhone: string | null;
  intent: string | null;
  message: string | null;
  callbackRequested: boolean | null;
}
export interface ConversationTurn { state: ConversationState; reply: string; completed: boolean; }

type Copy = {
  greeting: string;
  askName: string;
  askReason: (name: string | null) => string;
  askCallback: (owner: string, hasCallerId: boolean, urgent: boolean) => string;
  askPhone: (owner: string) => string;
  askYesNo: string;
  askPhoneAgain: string;
  callbackConfirmation: (owner: string, phone: string, name: string | null, urgent: boolean) => string;
  completedMessage: (owner: string, name: string | null, urgent: boolean) => string;
};
const prompts: Record<SupportedLanguage, Copy> = {
  en: {
    greeting: 'Hi, thanks for calling Yazonis Secrettera. I can take a message and make sure Yazoniii gets the details.',
    askName: 'Who am I speaking with?',
    askReason: name => `Thanks${name ? `, ${name}` : ''}. What can I help you with?`,
    askCallback: (owner, hasCallerId, urgent) => `${urgent ? 'I’ll flag this as urgent. ' : ''}I’ll pass ${owner} your name and the reason for your call. ${hasCallerId ? `Would you like ${owner} to call you back on this number?` : `Would you like ${owner} to call you back?`}`,
    askPhone: owner => `What number should ${owner} call you back on?`,
    askYesNo: 'Would you like a callback? Please say yes or no.',
    askPhoneAgain: 'I didn’t catch a complete number. Could you repeat it, including the country code?',
    callbackConfirmation: (owner, phone, name, urgent) => `Thanks${name ? `, ${name}` : ''}. I’ll pass ${owner} your name, the reason for your call, and your callback number (${phone}).${urgent ? ' I’ve marked the message urgent.' : ''} Goodbye.`,
    completedMessage: (owner, name, urgent) => `Thanks${name ? `, ${name}` : ''}. I’ll pass ${owner} your name and the reason for your call.${urgent ? ' I’ve marked the message urgent.' : ''} Goodbye.`
  },
  sv: {
    greeting: 'Hej och tack för att du ringer Yazonis Secrettera. Jag kan ta ett meddelande och se till att Yazoniii får informationen.',
    askName: 'Vem pratar jag med?',
    askReason: name => `Tack${name ? `, ${name}` : ''}. Vad gäller det?`,
    askCallback: (owner, hasCallerId, urgent) => `${urgent ? 'Jag markerar detta som brådskande. ' : ''}Jag skickar ditt namn och anledningen till samtalet till ${owner}. ${hasCallerId ? `Vill du att ${owner} ringer tillbaka till numret du ringer från?` : `Vill du att ${owner} ringer tillbaka?`}`,
    askPhone: owner => `Vilket nummer ska ${owner} ringa tillbaka till?`,
    askYesNo: 'Vill du bli uppringd? Svara gärna ja eller nej.',
    askPhoneAgain: 'Jag uppfattade inte ett fullständigt nummer. Kan du säga det igen, inklusive landskod?',
    callbackConfirmation: (owner, phone, name, urgent) => `Tack${name ? `, ${name}` : ''}. Jag skickar ditt namn, anledningen till samtalet och numret ${phone} till ${owner}.${urgent ? ' Jag har markerat meddelandet som brådskande.' : ''} Hej då.`,
    completedMessage: (owner, name, urgent) => `Tack${name ? `, ${name}` : ''}. Jag skickar ditt namn och anledningen till samtalet till ${owner}.${urgent ? ' Jag har markerat meddelandet som brådskande.' : ''} Hej då.`
  },
  ar: {
    greeting: 'مرحباً، شكراً لاتصالك بـ Yazonis Secrettera. يمكنني تسجيل رسالتك والتأكد من وصول التفاصيل إلى Yazoniii.',
    askName: 'مع من أتحدث؟',
    askReason: name => `شكراً لك${name ? ` يا ${name}` : ''}. كيف يمكنني مساعدتك؟`,
    askCallback: (owner, hasCallerId, urgent) => `${urgent ? 'سأضع علامة عاجل على رسالتك. ' : ''}سأرسل إلى ${owner} اسمك وسبب اتصالك. ${hasCallerId ? `هل تريد أن يتصل بك ${owner} على هذا الرقم؟` : `هل تريد أن يتصل بك ${owner}؟`}`,
    askPhone: owner => `ما الرقم الذي تريد من ${owner} الاتصال بك عليه؟`,
    askYesNo: 'هل ترغب في معاودة الاتصال؟ يرجى الإجابة بنعم أو لا.',
    askPhoneAgain: 'لم أتمكن من التقاط رقم كامل. هل يمكنك تكراره مع رمز الدولة؟',
    callbackConfirmation: (owner, phone, name, urgent) => `شكراً${name ? ` يا ${name}` : ''}. سأرسل إلى ${owner} اسمك وسبب اتصالك ورقم معاودة الاتصال ${phone}.${urgent ? ' وقد وضعت علامة عاجل على الرسالة.' : ''} إلى اللقاء.`,
    completedMessage: (owner, name, urgent) => `شكراً${name ? ` يا ${name}` : ''}. سأرسل إلى ${owner} اسمك وسبب اتصالك.${urgent ? ' وقد وضعت علامة عاجل على الرسالة.' : ''} إلى اللقاء.`
  }
};

export function createConversation(language: SupportedLanguage = 'en', callerPhone: string | null = null): ConversationTurn {
  const state: ConversationState = {
    priority: 'normal', language, stage: 'name', callerName: null,
    callerPhone: callerPhone && validPhone(callerPhone) ? callerPhone.slice(0, 40) : null,
    intent: null, message: null, callbackRequested: null
  };
  const copy = prompts[language];
  return { state, reply: `${copy.greeting} ${copy.askName}`, completed: false };
}
function cleanName(value: string): string {
  return value.trim().replace(/^(my name is|i am|i'm|this is|jag heter|mitt namn är|jag är|اسمي|أنا)\s+/iu, '').replace(/[.!?،،]+$/u, '').slice(0, 100);
}
function classifyIntent(value: string): string {
  if (/\b(appointment|book|booking|reschedule|möte|boka|omboka|موعد|حجز)\b/iu.test(value)) return 'appointment';
  if (/\b(price|pricing|cost|pris|kostar|سعر|تكلفة)\b/iu.test(value)) return 'pricing';
  if (/\b(open|opening hours|hours|öppet|öppettider|مفتوح|ساعات العمل)\b/iu.test(value)) return 'opening_hours';
  if (/\b(address|location|directions|adress|hitta|vägbeskrivning|عنوان|موقع)\b/iu.test(value)) return 'location';
  if (/\b(speak|talk|reach|contact|prata|tala|kontakta|أتحدث|التواصل)\b/iu.test(value)) return 'speak_to_owner';
  return 'general';
}
function isUrgent(value: string): boolean {
  const explicit = /\b(urgent|urgently|emergency|asap|immediately|right now|critical|brådskande|akut|genast|omedelbart|nu direkt)\b|عاجل|طارئ|فوراً|حالاً/iu.test(value);
  const family = /\b(mom|mum|mother|dad|father|parent|parents|mamma|morsa|pappa|förälder|föräldrar)\b|أمي|أبي|والدتي|والدي/iu.test(value);
  const request = /\b(need|needs|trying|wants|want|speak|talk|call|contact|tell|reach|important|must)\b|\b(behöver|måste|prata|ringa|kontakta|viktigt)\b|يريد|أحتاج|اتصل|أخبر/iu.test(value);
  return explicit || (family && request);
}
function isYes(value: string): boolean { return /^(yes|yeah|yep|ja|japp|absolut|gärna|نعم|أجل|أكيد)$/iu.test(value.trim().replace(/[.!؟?]/gu, '')); }
function isNo(value: string): boolean { return /^(no|nope|nej|nä|inte|لا|كلا)$/iu.test(value.trim().replace(/[.!؟?]/gu, '')); }
function validPhone(value: string): boolean {
  const digits = value.replace(/\D/gu, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+\d(][\d\s().+-]*$/u.test(value.trim());
}

export function advanceConversation(current: ConversationState, callerText: string, ownerName = 'Yazoniii'): ConversationTurn {
  const text = callerText.trim().slice(0, 2000);
  const language = detectLanguage(text, current.language);
  const copy = prompts[language];
  const state: ConversationState = { ...current, language };
  if (!text) return { state, reply: copy.askReason(state.callerName), completed: false };
  if (state.stage === 'complete') return { state, reply: state.callbackRequested && state.callerPhone ? copy.callbackConfirmation(ownerName, state.callerPhone, state.callerName, state.priority === 'urgent') : copy.completedMessage(ownerName, state.callerName, state.priority === 'urgent'), completed: true };
  if (state.stage === 'name') {
    state.callerName = cleanName(text) || null;
    state.stage = 'reason';
    return { state, reply: copy.askReason(state.callerName), completed: false };
  }
  if (state.stage === 'reason') {
    state.message = text;
    state.intent = classifyIntent(text);
    state.priority = isUrgent(text) ? 'urgent' : 'normal';
    state.stage = 'callback';
    return { state, reply: copy.askCallback(ownerName, Boolean(state.callerPhone), state.priority === 'urgent'), completed: false };
  }
  if (state.stage === 'callback') {
    if (isYes(text)) {
      state.callbackRequested = true;
      if (state.callerPhone) {
        state.stage = 'complete';
        return { state, reply: copy.callbackConfirmation(ownerName, state.callerPhone, state.callerName, state.priority === 'urgent'), completed: true };
      }
      state.stage = 'phone';
      return { state, reply: copy.askPhone(ownerName), completed: false };
    }
    if (isNo(text)) {
      state.callbackRequested = false;
      state.stage = 'complete';
      return { state, reply: copy.completedMessage(ownerName, state.callerName, state.priority === 'urgent'), completed: true };
    }
    return { state, reply: copy.askYesNo, completed: false };
  }
  if (state.stage === 'phone') {
    if (!validPhone(text)) return { state, reply: copy.askPhoneAgain, completed: false };
    state.callerPhone = text.slice(0, 40);
    state.stage = 'complete';
    return { state, reply: copy.callbackConfirmation(ownerName, state.callerPhone, state.callerName, state.priority === 'urgent'), completed: true };
  }
  return { state, reply: copy.completedMessage(ownerName, state.callerName, state.priority === 'urgent'), completed: true };
}
