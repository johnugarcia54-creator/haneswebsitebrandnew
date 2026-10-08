/* =========================================================================================
   auth/config.js: the public sign-in settings (ADDENDUM §6.3). Committed on purpose: the
   publishable key and the Turnstile site key are public by design. No secret ever goes here.

   Which block applies is chosen by location.host: the production host gets `production`,
   everything else (the staging alias, previews, localhost) gets `staging`. Both use the one
   Supabase project (integrator decision 1: staging shares it, with EXCHANGE_ALLOWLIST on the
   staging studio), so the /auth CSP's connect-src names exactly this URL.

   - publishableKey:   real. The project's enabled "default" key (read from project
                       mputtezdhevwwjgwktvi on 8 Oct; the same value the studio's fly.toml
                       carries), so the sign-in pages call Supabase. Supabase dashboard ->
                       Project Settings -> API Keys -> "default" (starts sb_publishable_).
                       If it ever read PLACEHOLDER again, the pages would say "Sign-in is being
                       set up" and make no call to Supabase.
   - turnstileSiteKey: still a PLACEHOLDER until the owner creates the widget (Cloudflare
                       dashboard -> Turnstile -> the widget for the launch origin and the
                       staging alias; starts 0x4). While it is, nothing loads from Cloudflare:
                       sign-in, resend and reset run without Turnstile and send no captcha
                       token, and sign-up stays closed. Setting it means changing the /auth CSP
                       in vercel.json in the same commit (script-src and frame-src gain
                       https://challenges.cloudflare.com); tests/config.test.mjs enforces this.
   ========================================================================================= */
export const SUPABASE_URL = 'https://mputtezdhevwwjgwktvi.supabase.co';
// SEC-2 (the custom domain, week 2) adds www.hanesdistribution.co.nz here
export const PRODUCTION_HOSTS = Object.freeze(['hanes-the-website-new.vercel.app']);

export const AUTH_CONFIG = Object.freeze({
  production: Object.freeze({
    supabaseUrl: SUPABASE_URL,
    publishableKey: 'sb_publishable_MoYnbvMfITHjpWEuBEe03Q_y_nSg3mK',
    turnstileSiteKey: 'PLACEHOLDER_TURNSTILE_SITE_KEY'
  }),
  staging: Object.freeze({
    supabaseUrl: SUPABASE_URL,
    publishableKey: 'sb_publishable_MoYnbvMfITHjpWEuBEe03Q_y_nSg3mK',
    turnstileSiteKey: 'PLACEHOLDER_TURNSTILE_SITE_KEY'
  })
});

const isProduction = host => PRODUCTION_HOSTS.includes(String(host || '').toLowerCase());

// Cloudflare's published test keys (always pass, always fail, ...) never count on production
const TURNSTILE_TEST_KEY = /^[123]x0{20}[A-Z]{2}$/;

// {name, supabaseUrl, publishableKey, turnstileSiteKey, supabaseReady, turnstileReady}
export function pickConfig(host, config = AUTH_CONFIG) {
  const name = isProduction(host) ? 'production' : 'staging';
  const c = config[name] || {};
  const real = v => typeof v === 'string' && v !== '' && !/placeholder/i.test(v);
  const supabaseReady = c.supabaseUrl === SUPABASE_URL && real(c.publishableKey) && /^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(c.publishableKey);
  const turnstileReady = real(c.turnstileSiteKey) && /^[0-3]x[A-Za-z0-9_-]{8,}$/.test(c.turnstileSiteKey) &&
    !(name === 'production' && TURNSTILE_TEST_KEY.test(c.turnstileSiteKey));
  return { name, supabaseUrl: c.supabaseUrl, publishableKey: c.publishableKey, turnstileSiteKey: c.turnstileSiteKey, supabaseReady, turnstileReady };
}
