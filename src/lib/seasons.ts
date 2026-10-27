// The themed style changes with the date: the same nine "seasons" as the author's website (albaro.dev) and
// AlbaRo Downloader, by fixed dates, so the three agree. Special days win over the plain seasons. Pure, so a
// test can try every date.

export const SEASONS = [
  "spring",
  "summer",
  "summerSun",
  "autumn",
  "winter",
  "christmas",
  "halloween",
  "easter",
  "anniversary",
] as const;

export type Season = (typeof SEASONS)[number];

// The season on `date`, in the date's own (local) calendar. The ranges are the website's:
//  - anniversary: 2 June
//  - Christmas: 15 December to 6 January
//  - Halloween: 30 October to 1 November
//  - Easter ("Semana Santa"): 29 March to 5 April
//  - spring: 20 March to 21 June
//  - summer: 21 June to 23 September, with its first half of July as `summerSun`
//  - autumn: 23 September to 21 December
//  - winter: 21 December to 20 March
export function seasonFor(date: Date): Season {
  const month = date.getMonth(); // 0 is January
  const day = date.getDate();

  if (month === 5 && day === 2) return "anniversary";
  if ((month === 11 && day >= 15) || (month === 0 && day <= 6)) return "christmas";
  if ((month === 9 && day >= 30) || (month === 10 && day <= 1)) return "halloween";
  if ((month === 2 && day >= 29) || (month === 3 && day <= 5)) return "easter";

  if ((month === 2 && day >= 20) || month === 3 || month === 4 || (month === 5 && day <= 21)) {
    return "spring";
  }
  if ((month === 5 && day >= 21) || month === 6 || month === 7 || (month === 8 && day <= 23)) {
    return month === 6 && day <= 15 ? "summerSun" : "summer";
  }
  if ((month === 8 && day >= 23) || month === 9 || month === 10 || (month === 11 && day <= 21)) {
    return "autumn";
  }
  return "winter";
}
