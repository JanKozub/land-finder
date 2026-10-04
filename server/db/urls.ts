/**
 * Derives a direct (non-pooled) connection URL for migrations from a pooled one:
 * Neon:     ep-xxx-pooler.region.aws.neon.tech → ep-xxx.region.aws.neon.tech
 * Supabase: aws-0-region.pooler.supabase.com:6543 (transaction) → :5432 (session)
 * Anything else is returned unchanged.
 */
export function deriveMigrationsUrl(url: string): string {
  if (!url || url.startsWith("pglite://")) return url;
  try {
    const u = new URL(url);
    if (u.hostname.includes("-pooler.")) {
      u.hostname = u.hostname.replace("-pooler.", ".");
      return u.toString();
    }
    if (u.hostname.endsWith("pooler.supabase.com") && u.port === "6543") {
      u.port = "5432";
      return u.toString();
    }
  } catch {
    // not a URL we understand
  }
  return url;
}
