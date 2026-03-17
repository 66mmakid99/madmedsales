import { supabase } from '../utils/supabase.js';
const { data, error } = await supabase.from('hospitals').select('*').ilike('name', '%프리마피부과%').limit(1);
if (error) console.log('ERROR:', error.message);
else if (data && data.length > 0) console.log('COLUMNS:', Object.keys(data[0]).join(', '));
else console.log('NO DATA');
