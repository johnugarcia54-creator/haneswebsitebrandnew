/* The never-say list, shared by tests/milli.test.mjs (guide-faq.json) and tests/og.test.mjs
   (the sharing cards). Not a test file itself: npm test runs tests/*.test.mjs only. */
// ADDENDUM §8.5 "Never say" (amended at 9670114) and the integrator's SEO-H0 list
export const NEVER = [
  /codemark/i, /branz/i, /\bmbie\b/i, /\bnzs\b/i, /as\s*\/\s*nzs/i, /\b(4211|4859(\.1)?|2269(\.1)?|4357(\.1)?|2208|4666|4223)\b/, /\bh3\.2\b/i, /\bh[1-6](\.\d)?\b/i,
  /\br-?values?\b/i, /\br\s?\d+(\.\d+)?\b/i, /\bu[gf]\b/i, /\bu-?values?\b/i, /w\/m²k/i, /\blow-?e\b/i, /\bgib\b/i, /certif/i, /\bstandards?\b/i, /\btest(ed|s|ing)?\b/i,
  /\bcompl(y|ies|iant|iance)\b/i, /\bapproved\b/i, /\bbuilding code\b/i, /soft-?coat/i, /akzo/i, /renolit/i, /\bpremium\b/i, /\binsulated against\b/i,
  /\b4\.9\b/, /\b30 reviews?\b/i, /\breviews?\b/i, /\bratings?\b/i, /\bstars?\b/i, /\bsample\b/i, /HAN-\d/i, /\bexample shipment\b/i,
  /opening hours/i, /\bopen (on|from|until|mon|tue|wed|thu|fri|sat|sun)/i, /\b\d{1,2}(:\d{2})?\s?(am|pm)\b/i, /\b(mon|tues?|wed|thur?s?|fri|sat|sun)(day)?\b/i,
  /\+64/, /\b0[2-9][\d\s-]{6,}\d\b/, /\b0800\b/, /\bphone (us|number)\b/i, /\bcall us\b/i,
  /\binstall/i, /\bfitting service\b/i, /\bwarrant/i, /\bguarantee/i, /\bdeposit/i, /\brefund/i, /\blead[- ]times?\b/i, /\b\d+\s*(days?|weeks?|months?)\b/i,
  /\bin stock\b/i, /\bout of stock\b/i, /\bstock levels?\b/i, /\bavailable now\b/i, /\bdiscount/i, /\b\d+\s?%/, /\bper ?cent\b/i, /\bsale\b/i, /\bfree (delivery|shipping|measure)/i,
  /\bmeasure (up|your site|on site)\b/i, /\bfinance\b/i
];
