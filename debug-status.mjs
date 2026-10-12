import http from 'node:http';
import { ApiClient } from './bot/api.js';

const HTML_LOGIN = `<html><body><form action="/auth/login" method="POST">
<input type="hidden" name="_token" value="abc123">
<input type="email" name="email"><input type="password" name="password">
</form></body></html>`;
const server = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    if (req.url === '/login') return res.end(HTML_LOGIN);
    if (req.url === '/auth/login') {
      res.statusCode = 302; res.setHeader('location', '/servers');
      res.setHeader('set-cookie', 'session=SECRETVAL; Path=/'); return res.end();
    }
    if (req.url === '/servers')
      return res.end('<ul><li data-server-id="12345"><a href="/servers/12345">GTAV</a> <span data-status="offline">Выключен</span> Оплачен до 13.10.2026</li></ul>');
    if (req.url === '/servers/12345')
      return res.end('<div data-status="offline">Оплачен до 13.10.2026</div><form method="POST"><input type="hidden" name="action" value="start"></form>');
    res.statusCode = 404; res.end('nf');
  });
});
await new Promise(r => server.listen(8746, r));
const cfg = { baseUrl: 'http://localhost:8746', login: 'a@b.c', password: 'p', serverId: '12345',
  sessionSecret: 'k'.repeat(64), sessionDir: './dbg-session', apiProfile: './dbg-profile.json' };
const log = { info: console.log, warn: console.warn, error: console.error, debug: console.debug };
const c = new ApiClient(cfg, log);
await c.ensureLogin();
console.log('profile:', JSON.stringify(c.profile?.serverDetailUrl), JSON.stringify(c.profile?.serversListUrl));
console.log('STATUS =', await c.getStatus());
server.close();
import fs from 'node:fs'; fs.rmSync('./dbg-session',{recursive:true,force:true}); fs.rmSync('./dbg-profile.json',{force:true});
