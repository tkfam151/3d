// ⚙️  Print Desk settings — the only file you need to edit.
//
// Get these two values from Supabase → Project Settings → API Keys / Data API.
// They're designed to be public: the database rules in supabase/setup.sql are
// what keep data safe, so it's fine that this file is visible on GitHub.
export const SUPABASE_URL = 'https://frqaolruwkmecsamedeb.supabase.co';   // e.g. 'https://abcdefghijkl.supabase.co'
export const SUPABASE_KEY = 'sb_publishable_Gt1rZdTnG3Gb67w8Lfa12w_uNh3Ti0K';   // the "anon public" or "publishable" key

export const SITE_NAME = 'Print Desk';
export const LOCATIONS = ['PU2', 'PU3'];  // pickup spots teachers choose from
export const MAX_MODEL_MB = 50;           // Supabase's free plan allows up to 50 MB per file
