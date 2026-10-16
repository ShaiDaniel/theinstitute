// Hebrew and English, with the page direction following the language.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'he';

const STRINGS = {
  en: {
    tagline: 'Albums, bands, songs and concerts — ranked by the people who were there.',
    showcase: 'Showcase',
    people: 'People',
    chat: 'mIRC',
    about: 'About',
    signIn: 'Sign in',
    signOut: 'Sign out',
    comingSoon: 'Coming soon',
    showcaseIntro: 'Everyone’s ranked albums, bands, songs and concerts. Sign in to build yours.',
    peopleIntro: 'Members and their showcases.',
    chatIntro: 'Channels, nicks, /me and all — like it’s 1999.',
    aboutIntro: 'A home for a group of friends who met on mIRC in the 90s and never stopped arguing about music.',
    signInToCreate: 'Sign in with Google to create your page.',
    yourProfile: 'Your profile',
    createProfile: 'Create your profile',
    createProfileIntro: 'You’re signed in. Create your profile to become a member.',
    finishProfile: 'You’re signed in. Create your profile to become a member →',
    displayName: 'Name',
    whoCanSee: 'Who can see your page',
    visPublic: 'Everyone',
    visPublicHint: 'anyone with the link, signed in or not',
    visMembers: 'Members only',
    visMembersHint: 'only people signed in with a profile',
    save: 'Save',
    create: 'Create profile',
    saved: 'Saved.',
    saveError: 'Couldn’t save. Try again.',
    deleteProfile: 'Delete profile',
    deleteConfirm: 'Delete your profile? This can’t be undone.',
  },
  he: {
    tagline: 'אלבומים, להקות, שירים והופעות — מדורגים על ידי מי שהיה שם.',
    showcase: 'תצוגה',
    people: 'אנשים',
    chat: 'mIRC',
    about: 'אודות',
    signIn: 'התחברות',
    signOut: 'התנתקות',
    comingSoon: 'בקרוב',
    showcaseIntro: 'האלבומים, הלהקות, השירים וההופעות של כולם, מדורגים. התחברו כדי לבנות את שלכם.',
    peopleIntro: 'החברים והתצוגות שלהם.',
    chatIntro: 'ערוצים, ניקים, ‎/me‎ והכל — כאילו זה 1999.',
    aboutIntro: 'בית לחבורה שהכירה ב-mIRC בשנות ה-90 ומאז לא הפסיקה להתווכח על מוזיקה.',
    signInToCreate: 'התחברו עם Google כדי ליצור את הדף שלכם.',
    yourProfile: 'הפרופיל שלך',
    createProfile: 'יצירת פרופיל',
    createProfileIntro: 'התחברת. צור/י פרופיל כדי להיות חבר/ה.',
    finishProfile: 'התחברת. צור/י פרופיל כדי להיות חבר/ה ←',
    displayName: 'שם',
    whoCanSee: 'מי יכול לראות את הדף שלך',
    visPublic: 'כולם',
    visPublicHint: 'כל מי שיש לו את הקישור, מחובר או לא',
    visMembers: 'חברים בלבד',
    visMembersHint: 'רק מי שמחובר ויש לו פרופיל',
    save: 'שמירה',
    create: 'יצירת פרופיל',
    saved: 'נשמר.',
    saveError: 'השמירה נכשלה. נסו שוב.',
    deleteProfile: 'מחיקת פרופיל',
    deleteConfirm: 'למחוק את הפרופיל? אי אפשר לבטל.',
  },
} as const;

export type StringKey = keyof (typeof STRINGS)['en'];

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey) => string;
}

const I18nContext = createContext<I18n | null>(null);

const initialLang = (): Lang => {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'he' || saved === 'en') return saved;
  } catch {
    // Storage unavailable.
  }
  return navigator.language.startsWith('he') ? 'he' : 'en';
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'he' ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('lang', lang);
    } catch {
      // Not remembered.
    }
  }, [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t: (key) => STRINGS[lang][key] }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n outside I18nProvider');
  return ctx;
}
