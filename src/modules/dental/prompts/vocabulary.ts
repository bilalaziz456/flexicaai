/**
 * Dental words for speech-to-text (owner's call, 2026-10-20): what a dentist says that
 * Whisper tends to mishear — terms, abbreviations, and FDI tooth numbers, which are
 * spoken as "four six" and must come out as 46.
 *
 * The module's half of the vocabulary hint; core adds general clinical words and the
 * medicine names first (core/ai/scribe-vocabulary.ts). Whisper reads only ~224 tokens
 * in all, so this stays to dentistry's own words, most-misheard first.
 */
export const dentalScribeVocabulary: readonly string[] = [
  "tooth 11", "tooth 26", "tooth 36", "tooth 46", "tooth 48",
  "caries", "periapical", "radiolucency", "pulpitis", "apical periodontitis",
  "RCT", "root canal treatment", "pulpotomy", "pulpectomy", "extraction",
  "scaling", "polishing", "composite", "GIC", "amalgam", "crown", "bridge",
  "denture", "implant", "abscess", "gingivitis", "periodontitis", "pocket depth",
  "mobility", "tenderness on percussion", "OPG", "IOPA", "occlusal", "mesial",
  "distal", "buccal", "lingual", "palatal",
];
