import { createClient } from '@supabase/supabase-js';

const supabaseUrl = '당신의_SUPABASE_URL';
const supabaseAnonKey = '당신의_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);