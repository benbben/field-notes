// Build identifier injected by vite.config.js (`define`): "<git short sha> · <YYYY-MM-DD>".
// Guarded so this module also loads in plain Node (tests) where the define is absent.
export const APP_VERSION = (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__) ? __APP_VERSION__ : 'dev';
