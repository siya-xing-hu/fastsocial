export type TranslationProvider = 'google' | 'deepl' | 'ai';

/** The provider that produced the text, including any automatic fallback. */
export interface TranslationResult {
  text: string;
  provider: TranslationProvider;
}
