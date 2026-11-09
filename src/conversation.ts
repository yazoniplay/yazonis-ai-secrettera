import { detectLanguage, type SupportedLanguage } from './language.js';

export type ConversationStage = 'name' | 'reason' | 'callback' | 'phone' | 'complete';

export interface ConversationState {
  language: SupportedLanguage;
  stage: ConversationStage;
  callerName: string | null;
  callerPhone: string | null;
  intent: string | null;
  message: string | null;
  callbackRequested: boolean | null;
}

export interface ConversationTurn {
  state: ConversationState;
  reply: string;
  completed: boolean;
}

const prompts: Record<SupportedLanguage, {
  greeting: string;
  askName: string;
  askReason: (name: string | null) => string;
  askCallback: string;
  askPhone: string;
  askYesNo: string;
  askPhoneAgain: string;
  completed: string;
}> = {
  en: {
    greeting: 'Hello, you have reached Yazonis Secrettera, the virtual receptionist. I can take a message and arrange a callback.',
    askName: 'May I have your name, please?',
    askReason: (name) => `Thank you${name ? `, ${name}` : ''}. How can I help you today?`,
    askCallback: 'Would you like someone to call you back? Please answer yes or no.',
    askPhone: 'What number should the person call you back on?',
    askYesNo: 'Please say yes if you would like a callback, or no if you do not.',
    askPhoneAgain: 'That does not look like a complete phone number. Please say the number including its country code.',
    completed: 'Thank you. I have saved your message and callback details. Goodbye.'
  },
  sv: {
    greeting: 'Hej och välkommen till Yazonis Secrettera, den virtuella receptionisten. Jag kan ta ett meddelande och ordna att du blir uppringd.',
    askName: 'Vad heter du?',
    askReason: (name) => `Tack${name ? `, ${name}` : ''}. Vad kan jag hjälpa dig med?`,
    askCallback: 'Vill du att någon ringer tillbaka? Svara gärna ja eller nej.',
    askPhone: 'Vilket nummer ska personen ringa tillbaka till?',
    askYesNo: 'Säg ja om du vill bli uppringd, eller nej om du inte vill det.',
    askPhoneAgain: 'Det verkar inte vara ett fullständigt telefonnummer. Ange numret inklusive landskod.',
    completed: 'Tack. Jag har sparat ditt meddelande och dina kontaktuppgifter. Hej då.'
  },
  ar: {
    greeting: 'مرحباً، لقد وصلت إلى Yazonis Secrettera، موظف الاستقبال الافتراضي. يمكنني تسجيل رسالة وترتيب معاودة الاتصال بك.',
    askName: 'ما اسمك من فضلك؟',
    askReason: (name) => `شكراً لك${name ? ` يا ${name}` : ''}. كيف يمكنني مساعدتك اليوم؟`,
    askCallback: 'هل ترغب في أن يتصل بك أحد؟ يرجى الإجابة بنعم أو لا.',
    askPhone: 'ما الرقم الذي يمكن للشخص الاتصال بك عليه؟',
    askYesNo: 'يرجى الإجابة بنعم إذا كنت ترغب في معاودة الاتصال، أو لا إذا لم ترغب بذلك.',
    askPhoneAgain: 'يبدو أن رقم الهاتف غير مكتمل. يرجى ذكر الرقم مع رمز الدولة.',
    completed: 'شكراً لك. لقد حفظت رسالتك وبيانات الاتصال. إلى اللقاء.'
  }
};

export function createConversation(language: SupportedLanguage = 'en'): ConversationTurn {
  const state: ConversationState = {
    language,
    stage: 'name',
    callerName: null,
    callerPhone: null,
    intent: null,
    message: null,
    callbackRequested: null
  };
  const copy = prompts[language];
  return { state, reply: `${copy.greeting} ${copy.askName}`, completed: false };
}

function cleanName(value: string): string {
  return value.trim()
    .replace(/^(my name is|i am|i'm|this is|jag heter|mitt namn är|jag är|اسمي|أنا)\s+/iu, '')
    .replace(/[.!?،،]+$/u, '')
    .slice(0, 100);
}

function classifyIntent(value: string): string {
  if (/\b(appointment|book|booking|reschedule|möte|boka|omboka|موعد|حجز)\b/iu.test(value)) return 'appointment';
  if (/\b(price|pricing|cost|pris|kostar|سعر|تكلفة)\b/iu.test(value)) return 'pricing';
  if (/\b(open|opening hours|hours|öppet|öppettider|مفتوح|ساعات العمل)\b/iu.test(value)) return 'opening_hours';
  if (/\b(address|location|directions|adress|hitta|vägbeskrivning|عنوان|موقع)\b/iu.test(value)) return 'location';
  if (/\b(speak|talk|reach|contact|prata|tala|kontakta|أتحدث|التواصل)\b/iu.test(value)) return 'speak_to_owner';
  return 'general';
}

function isYes(value: string): boolean {
  return /^(yes|yeah|yep|ja|japp|absolut|gärna|نعم|أجل|أكيد)$/iu.test(value.trim().replace(/[.!؟?]/gu, ''));
}

function isNo(value: string): boolean {
  return /^(no|nope|nej|nä|inte|لا|كلا)$/iu.test(value.trim().replace(/[.!؟?]/gu, ''));
}

function validPhone(value: string): boolean {
  const digits = value.replace(/\D/gu, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+\d(][\d\s().+-]*$/u.test(value.trim());
}

export function advanceConversation(current: ConversationState, callerText: string): ConversationTurn {
  const text = callerText.trim().slice(0, 2000);
  const language = detectLanguage(text, current.language);
  const copy = prompts[language];
  const state: ConversationState = { ...current, language };

  if (!text) return { state, reply: copy.askReason(state.callerName), completed: false };
  if (state.stage === 'complete') {
    return { state, reply: copy.completed, completed: true };
  }

  if (state.stage === 'name') {
    state.callerName = cleanName(text) || null;
    state.stage = 'reason';
    return { state, reply: copy.askReason(state.callerName), completed: false };
  }

  if (state.stage === 'reason') {
    state.message = text;
    state.intent = classifyIntent(text);
    state.stage = 'callback';
    return { state, reply: copy.askCallback, completed: false };
  }

  if (state.stage === 'callback') {
    if (isYes(text)) {
      state.callbackRequested = true;
      state.stage = 'phone';
      return { state, reply: copy.askPhone, completed: false };
    }
    if (isNo(text)) {
      state.callbackRequested = false;
      state.stage = 'complete';
      return { state, reply: copy.completed, completed: true };
    }
    return { state, reply: copy.askYesNo, completed: false };
  }

  if (state.stage === 'phone') {
    if (!validPhone(text)) return { state, reply: copy.askPhoneAgain, completed: false };
    state.callerPhone = text.slice(0, 40);
    state.stage = 'complete';
    return { state, reply: copy.completed, completed: true };
  }

  return { state, reply: copy.completed, completed: true };
}
