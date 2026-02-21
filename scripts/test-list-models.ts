import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { getAccessToken } from './analysis/gemini-auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '.env') });

const token = await getAccessToken();
try {
  const resp = await axios.get('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { Authorization: `Bearer ${token}` },
    params: { pageSize: 100 },
    timeout: 15000,
  });
  const names = (resp.data.models as Array<{ name: string }>)
    .map((m) => m.name)
    .filter((n) => n.includes('gemini'))
    .sort();
  console.log(`Found ${names.length} Gemini models:`);
  for (const n of names) console.log(' ', n);
} catch (e: unknown) {
  const err = e as { response?: { status?: number }; message?: string };
  console.log('Error:', err.response?.status, err.message);
}
