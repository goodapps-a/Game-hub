export interface VoiceCalloutSpec {
  readonly id: string;
  readonly calloutId: string;
  readonly label: string;
  readonly spokenText: string;
  readonly styleCue: string;
}

export const HOKM_VOICE_CALLOUTS: readonly VoiceCalloutSpec[] = [
  {
    id: 'vox-dastkhosh',
    calloutId: 'dastkhosh',
    label: 'دست خووووش!',
    spokenText: 'دَست خووووش!',
    styleCue: 'Enthusiastic, deep, warm, masculine Iranian man cheering loudly with genuine admiration at a card table',
  },
  {
    id: 'vox-eyval',
    calloutId: 'eyval',
    label: 'ایووول!',
    spokenText: 'اِیوووول! دَمِت گَرم!',
    styleCue: 'Bold, deep, charismatic masculine Iranian voice exclaiming excitement and approval',
  },
  {
    id: 'vox-afarin',
    calloutId: 'afarin',
    label: 'آفرین داش!',
    spokenText: 'آفَرین داش، عالی بازی کَردی!',
    styleCue: 'Friendly, deep-voiced masculine Iranian man praising his card partner warmly',
  },
  {
    id: 'vox-boridam',
    calloutId: 'boridam',
    label: 'عجب بُرشی!',
    spokenText: 'عَجَب بُرِشی زَدی!',
    styleCue: 'Impressed, deep masculine Iranian voice reacting dramatically to a strong trump cut',
  },
  {
    id: 'vox-hakem',
    calloutId: 'hakem',
    label: 'حاکم تویی!',
    spokenText: 'حاکِمِ واقعی تویی!',
    styleCue: 'Confident, deep baritone Iranian male voice delivering playful respect',
  },
  {
    id: 'vox-bordim',
    calloutId: 'bordim',
    label: 'بُردیم دیگه!',
    spokenText: 'بُردیم دیگه! تَمومِ کار!',
    styleCue: 'Triumphant, deep masculine Iranian voice celebrating a big win',
  },
  {
    id: 'vox-kot',
    calloutId: 'kot',
    label: 'کُت شدین!',
    spokenText: 'کُت شُدین رِفیق! کارِش تَمومه!',
    styleCue: 'Playfully teasing, bold deep-voiced masculine Iranian man',
  },
  {
    id: 'vox-chedasti',
    calloutId: 'chedasti',
    label: 'چه دستی بود!',
    spokenText: 'عَجَب دَستی بود این دَست!',
    styleCue: 'Amazed, deep masculine Iranian baritone voice admiring a great hand',
  },
  {
    id: 'vox-havaset',
    calloutId: 'havaset',
    label: 'حواستو جمع کن!',
    spokenText: 'حَواسِتو جَمع کُن یار!',
    styleCue: 'Playful, firm, deep masculine Iranian voice warning his teammate',
  },
  {
    id: 'vox-bezanberim',
    calloutId: 'bezanberim',
    label: 'بزن بریم!',
    spokenText: 'بِزَن بِریم! شُروع کُن!',
    styleCue: 'Energetic, deep masculine Iranian voice hyping up the game',
  },
  {
    id: 'vox-eybaba',
    calloutId: 'eybaba',
    label: 'ای بابا!',
    spokenText: 'اِی بابا! عَجَب شانسی!',
    styleCue: 'Dramatically exasperated yet humorous deep masculine Iranian voice',
  },
  {
    id: 'vox-dametgarm',
    calloutId: 'dametgarm',
    label: 'دمت گرم!',
    spokenText: 'دَمِت گَرم واقِعاً! حال کَردَم!',
    styleCue: 'Warm, hearty, deep masculine Iranian man expressing heartfelt appreciation',
  },
];

export const VOICE_CALLOUT_BY_ID: ReadonlyMap<string, VoiceCalloutSpec> =
  new Map(HOKM_VOICE_CALLOUTS.map((v) => [v.calloutId, v]));
