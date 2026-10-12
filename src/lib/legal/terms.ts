/**
 * Which version of the Terms and Privacy Policy a new account accepted at
 * sign-up. Stored per account by migration 0061 (user_settings.terms_version,
 * written by the database at account creation).
 *
 * Change this whenever /terms or /privacy changes in a way a user should
 * agree to again, so the record can tell who accepted which wording.
 */
export const TERMS_VERSION = "2026-10-09";

/** The minimum age stated in the Terms and confirmed at sign-up. */
export const MINIMUM_AGE = 18;
