function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  discogsToken: () => required("DISCOGS_USER_TOKEN"),
  discogsUserAgent: () => process.env.DISCOGS_USER_AGENT || "Discoschetos/2.0",
  igUserId: () => required("IG_USER_ID"),
  igAccessToken: () => required("IG_ACCESS_TOKEN"),
  youtubeApiKey: () => process.env.YOUTUBE_API_KEY || null,
};
