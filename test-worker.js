
import fs from 'node:fs';
export default {
  async fetch(req, env) {
    try {
      const txt = fs.readFileSync('package.json', 'utf8');
      return new Response('OK: ' + txt.substring(0,20));
    } catch(e) {
      return new Response('ERR: ' + e.message);
    }
  }
};
