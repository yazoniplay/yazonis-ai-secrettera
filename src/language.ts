export const SUPPORTED_LANGUAGES = ['en', 'sv', 'ar'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const swedishMarkers = /\b(hej|tack|gärna|nej|ja|också|är|det|jag|du|inte|kan|vill|vad|var|när|hur|för|med|och|eller|god|morgon|middag|kväll)\b|[åäö]/iu;
const englishMarkers = /\b(hello|hi|thanks|please|yes|no|what|where|when|how|can|could|would|i|you|the|and|or|not|good|morning|afternoon)\b/iu;
const arabicScript = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/u;

export function detectLanguage(text: string, fallback: SupportedLanguage = 'en'): SupportedLanguage {
  const value = text.trim();
  if (!value) return fallback;
  if (arabicScript.test(value)) return 'ar';

  const swedishMatches = value.match(new RegExp(swedishMarkers.source, 'giu'))?.length ?? 0;
  const englishMatches = value.match(new RegExp(englishMarkers.source, 'giu'))?.length ?? 0;

  if (swedishMatches > englishMatches) return 'sv';
  if (englishMatches > 0) return 'en';
  return fallback;
}

export interface ReceptionPhrases {
  greeting: string;
  unavailable: string;
  busy: string;
  takeMessage: string;
}

const phrases: Record<SupportedLanguage, ReceptionPhrases> = {
  en: {
    greeting: 'Hello, you have reached Yazonis Secrettera. How can I help?',
    unavailable: 'The person you are trying to reach is unavailable right now.',
    busy: 'They are busy at the moment.',
    takeMessage: 'Would you like to leave a message or request a callback?'
  },
  sv: {
    greeting: 'Hej, du har kommit till Yazonis Secrettera. Hur kan jag hjälpa dig?',
    unavailable: 'Personen du söker är inte tillgänglig just nu.',
    busy: 'Personen är upptagen för tillfället.',
    takeMessage: 'Vill du lämna ett meddelande eller be om att bli uppringd?'
  },
  ar: {
    greeting: 'مرحباً، لقد وصلت إلى Yazonis Secrettera. كيف يمكنني مساعدتك؟',
    unavailable: 'الشخص الذي تحاول التواصل معه غير متاح حالياً.',
    busy: 'الشخص مشغول حالياً.',
    takeMessage: 'هل ترغب في ترك رسالة أو طلب معاودة الاتصال؟'
  }
};

export function getReceptionPhrases(language: SupportedLanguage): ReceptionPhrases {
  return phrases[language];
}
