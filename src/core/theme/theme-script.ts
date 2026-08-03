import { THEME_COOKIE_NAME } from "./theme";

/**
 * The no-flash theme script, inlined by the root layout as the first thing in <body>.
 *
 * WHY it reads the cookie itself instead of being handed the value: the root layout
 * must not call cookies()/headers(), because anything a root layout reads opts EVERY
 * route beneath it into dynamic rendering — which would stop the public marketing
 * pages from being statically generated (CLAUDE.md §7). Reading `document.cookie`
 * client-side keeps the layout (and this string) fully static.
 *
 * That the cookie is readable from JS is by design, not an oversight: it is NOT
 * HttpOnly, and the theme toggle already writes it the same way
 * (core/ui/theme-toggle.tsx). It holds a display preference, never anything secret.
 *
 * Being a constant matters twice over: the proxy hashes this exact string for the
 * CSP (see src/proxy.ts), and a static string is what lets a prerendered page carry
 * it. Change the script and the hash follows automatically — never inline a copy.
 */
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE_NAME}=([^;]*)/);var p=m?decodeURIComponent(m[1]):'system';if(p!=='light'&&p!=='dark')p='system';var q=window.matchMedia('(prefers-color-scheme: dark)');function a(){var d=p==='dark'||(p==='system'&&q.matches);document.documentElement.classList.toggle('dark',d);}a();if(p==='system'&&q.addEventListener){q.addEventListener('change',a);}}catch(e){}})();`;
