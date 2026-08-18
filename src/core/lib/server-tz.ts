import "server-only";

/**
 * The IANA zone this server's `Date` maths uses.
 *
 * Everything user-facing is computed in the server's local clock — day bounds,
 * doctor availability, the reminder cron, the date embedded in an MRN. Postgres,
 * meanwhile, formats a `timestamptz` in whatever zone the CONNECTION happens to
 * carry, which is not the same thing and in practice often isn't even close (a
 * dev box here reports America/Los_Angeles). So any SQL that renders a
 * timestamptz as a date or buckets by day must pin the zone explicitly with
 * `AT TIME ZONE`, or it silently disagrees with what the app displayed.
 *
 * See the timezone caveat in .claude/database.md: when clinics get their own
 * timezones, this constant is one of the places that has to become per-clinic.
 */
export const SERVER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
