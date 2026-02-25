import { Hono } from 'hono';
import hospitals from './hospitals.js';
import contacts from './contacts.js';
import equipment from './equipment.js';
import products from './products.js';
import franchises from './franchises.js';

type Bindings = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
};

const crm = new Hono<{ Bindings: Bindings }>();

crm.route('/hospitals', hospitals);
crm.route('/contacts', contacts);
crm.route('/equipment', equipment);
crm.route('/products', products);
crm.route('/franchises', franchises);

export default crm;
