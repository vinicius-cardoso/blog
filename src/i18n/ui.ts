/**
 * UI strings. Article content lives in src/content/articles/<lang>/;
 * this file covers only chrome — nav, labels, series affordances.
 */

export const languages = { en: "English", pt: "Português" } as const;
export type Lang = keyof typeof languages;

export const defaultLang: Lang = "en";

/** Route prefix for a language. English is at the root, pt-BR under /pt. */
export const prefix: Record<Lang, string> = { en: "", pt: "/pt" };

export const ui = {
  en: {
    "nav.about": "About",
    "nav.github": "GitHub profile",
    "nav.linkedin": "LinkedIn profile",
    "nav.home": "Articles",
    "nav.rss": "RSS feed",

    "theme.toggle": "Switch theme",
    "theme.light": "Light",
    "theme.dark": "Dark",

    "lang.switch": "Read in Portuguese",
    "lang.other": "Português",

    "series.label": "Series",
    "series.parts": (n: number) => `${n} ${n === 1 ? "part" : "parts"}`,
    "series.part": (n: number, total: number) => `Part ${n} of ${total}`,
    "series.readAll": "Read all parts as one page",
    "series.readAllTime": (n: number) => `${n} min total`,
    "series.index": "All parts",
    "series.next": "Next part",
    "series.prev": "Previous part",
    "series.backTo": "Back to the series",

    "article.readingTime": (n: number) => `${n} min read`,
    "article.updated": "Updated",
    "article.draft": "Draft",

    "translation.missing":
      "This part hasn’t been translated yet — showing the English version.",

    "list.empty": "Nothing published yet.",
    "footer.source": "Source on GitHub",
  },

  pt: {
    "nav.about": "Sobre",
    "nav.github": "Perfil no GitHub",
    "nav.linkedin": "Perfil no LinkedIn",
    "nav.home": "Artigos",
    "nav.rss": "Feed RSS",

    "theme.toggle": "Alternar tema",
    "theme.light": "Claro",
    "theme.dark": "Escuro",

    "lang.switch": "Ler em inglês",
    "lang.other": "English",

    "series.label": "Série",
    "series.parts": (n: number) => `${n} ${n === 1 ? "parte" : "partes"}`,
    "series.part": (n: number, total: number) => `Parte ${n} de ${total}`,
    "series.readAll": "Ler todas as partes numa página só",
    "series.readAllTime": (n: number) => `${n} min no total`,
    "series.index": "Todas as partes",
    "series.next": "Próxima parte",
    "series.prev": "Parte anterior",
    "series.backTo": "Voltar para a série",

    "article.readingTime": (n: number) => `${n} min de leitura`,
    "article.updated": "Atualizado",
    "article.draft": "Rascunho",

    "translation.missing":
      "Esta parte ainda não foi traduzida — mostrando a versão em inglês.",

    "list.empty": "Nada publicado ainda.",
    "footer.source": "Código no GitHub",
  },
} as const;

/** Returns a lookup bound to one language, falling back to English. */
export function useTranslations(lang: Lang) {
  return function t<K extends keyof (typeof ui)["en"]>(key: K) {
    return (ui[lang] as (typeof ui)["en"])[key] ?? ui[defaultLang][key];
  };
}

/** Builds an in-site URL for a language, e.g. ("pt", "/blog/x") -> "/pt/blog/x" */
export function localise(lang: Lang, path: string) {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${prefix[lang]}${clean}` || "/";
}
