import "server-only";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * SEC data endpoints ask automated clients to identify the application and
 * provide a monitored contact. Keep the operator's address in runtime config,
 * never in source control, and disable uncached SEC requests until it exists.
 */
export function secRequestHeaders(accept = "application/json") {
  const contact = process.env.GEXLAB_SEC_CONTACT?.trim();
  if (!contact || !EMAIL_PATTERN.test(contact)) {
    throw new Error("Set GEXLAB_SEC_CONTACT to a monitored email before requesting SEC data.");
  }

  return {
    "User-Agent": `GEXLab/3.0 (${contact})`,
    Accept: accept,
  };
}
