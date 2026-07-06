/**
 * Dependency-free auth constants. Safe to import from ANY runtime — including
 * the Edge proxy, which must not pull in Node-only modules (pg, crypto, etc.).
 */
export const SESSION_COOKIE_NAME = "klenic_session";
