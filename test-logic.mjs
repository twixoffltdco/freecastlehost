// Юнит-тесты парсеров и криптографии api.js + интеграция с mock-сервером
import assert from 'node:assert';
import http from 'node:http';
import { parseForms, parseTags, extractExpiresDate, extractStatus, encryptJson, decryptJson, ApiClient } from './bot/api.js';

const HTML_LOGIN = `<html><body><form action="/auth/login" method="POST">
<input type="hidden" name="_token" value="abc123">
<input type="email" name="email" value="">
<input type="password" name="password">
<button type="submit">Войти</button></form></body></html>`;

const forms = parseForms(HTML_LOGIN, 'https://x.test/login');
assert.equal(forms.length, 1);
assert.equal(forms[0].action, 'https://x.test/auth/login');
assert.equal(forms[0].method, 'POST');
assert.deepEqual(forms[0].inputs.map(i=>i.name).sort(), ['_token','email','password']);
console.log('parseForms OK');

assert.equal(extractStatus('<div data-status="online">'), 'online');
assert.equal(extractStatus('<span class="s">Сервер: Остановлен</span>'), 'offline');
assert.equal(extractStatus('<b>Запущен</b>'), 'online');
assert.equal(extractStatus('ничего не понятно'), 'unknown');
console.log('extractStatus OK');

const d1 = extractExpiresDate('<p>Оплачен до <b>15.10.2026</b></p>');
assert(d1 && d1.getFullYear() === 2026 && d1.getMonth() === 9 && d1.getDate() === 15);
const d2 = extractExpiresDate('<td>Next payment: 2026-11-03</td>');
assert(d2 && d2.getMonth() === 10 && d2.getDate() === 3);
const d3 = extractExpiresDate('<div data-expires-at="2027-01-05">x</div>');
assert(d3 && d3.getFullYear() === 2027);
console.log('extractExpiresDate OK');

const secret = 'k'.repeat(64);
const enc = encryptJson({ cookies: [{name:'a',value:'b'}] }, secret);
assert(!enc.includes('"a"'));
assert.deepEqual(decryptJson(enc, secret).cookies[0], {name:'a',value:'b'});
assert.throws(() => decryptJson(enc, 'wrong'.repeat(10)));
console.log('encrypt/decrypt OK');

// --- Интеграция: mock-панель Castle Host ---
let loginPosts = [];
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    if (req.url === '/login') { res.setHeader('set-cookie','sess=anon; Path=/'); res.end(HTML_LOGIN); }
    else if (req.url === '/auth/login' && req.method === 'POST') {
      loginPosts.push(body);
      if (body.includes('test@example.com') && body.includes('_token=abc123')) {
        res.statusCode = 302;
        res.setHeader('location', '/servers');
        res.setHeader('set-cookie', 'session=SECRETVAL; Path=/; HttpOnly');
        res.end();
      } else { res.statusCode = 200; res.end('Неверный логин или пароль'); }
    }
    else if (req.url === '/servers') {
      if (req.headers.cookie?.includes('session=SECRETVAL'))
        res.end('<ul><li data-server-id="12345"><a href="/servers/12345">GTAV</a> <span data-status="offline">Выключен</span> Оплачен до 13.10.2026</li></ul>');
      else { res.statusCode = 302; res.setHeader('location','/login'); res.end(); }
    }
    else if (req.url === '/servers/12345') {
      if (!req.headers.cookie?.includes('session=SECRETVAL')) { res.statusCode=302; res.setHeader('location','/login'); return res.end(); }
      if (req.method === 'POST' && body.includes('action=start')) { res.end('<div class="alert-success">Сервер запущен</div>'); startCount++; return; }
      if (req.method === 'POST' && body.includes('action=renew')) { renewCount++; res.end('<div class="alert-success">Продлено</div>'); return; }
      res.end(`<div data-status="${startCount>0?'online':'offline'}">Оплачен до 13.10.2026</div>
<form method="POST" action="/servers/12345"><input type="hidden" name="_token" value="tok9"><input type="hidden" name="action" value="start"><button>Включить сервер</button></form>
<form method="POST" action="/servers/12345"><input type="hidden" name="_token" value="tok9"><input type="hidden" name="action" value="renew"><select name="period"><option value="7">7 дней</option></select><button>Продлить</button></form>`);
    }
    else if (req.url === '/billing') res.end('<p>Баланс: 1 500.25 ₽</p>');
    else { res.statusCode = 404; res.end('not found'); }
  });
});
let startCount = 0, renewCount = 0;
await new Promise(r => server.listen(8745, r));

const base = 'http://localhost:8745';
const cfg = { baseUrl: base, login: 'test@example.com', password: 'secret_test_password_123', serverId: '12345',
  sessionSecret: secret, sessionDir: './test-session', apiProfile: './test-api-profile.json',
  renewThresholdHours: 24, renewDays: 7, maxRetries: 1, retryAfterMin: 0 };
const quietLog = { info: console.log, warn: console.warn, error: console.error, debug: ()=>{} };

const client = new ApiClient(cfg, quietLog);
await client.discover();
assert(client.profile.login, 'login discovered');
assert.equal(client.profile.login.url, base + '/auth/login');
assert.equal(client.profile.login.csrfField, '_token');
assert(client.profile.start, 'start action discovered');
assert(client.profile.renew, 'renew action discovered');
console.log('discover OK:', JSON.stringify({login:client.profile.login.userField, start:client.profile.start.url, renew:client.profile.renew.url}));

// статус через HTTP (без браузера!)
const st = await client.getStatus();
assert.equal(st, 'offline');
const end = await client.getRentEndDate();
assert(end.getTime() < Date.now(), 'rent expired date parsed');
console.log('getStatus/getRentEndDate OK');

// включение: POST формы нет — но profile.start указывает на форму страницы
const started = await client.startServer();
assert.equal(started, true);
assert(startCount >= 1);
console.log('startServer via HTTP form POST OK, CSRF token sent:', loginPosts.length === 1 ? '(login had _token)' : '');

// продление
const renewed = await client.renewAndPay();
assert(renewCount >= 1);
console.log('renewAndPay OK, renewCount=', renewCount);

// сессия сохранена зашифрованной, без пароля
import fs from 'node:fs';
const raw = fs.readFileSync('./test-session/session.json', 'utf8');
assert(!raw.includes('secret_test_password'));
assert(!raw.includes('SECRETVAL')); // cookies зашифрованы
assert(fs.readFileSync('./test-api-profile.json','utf8').length > 0);
console.log('session encrypted on disk OK');

// восстановление сессии в новом клиенте БЕЗ повторного входа
const client2 = new ApiClient(cfg, quietLog);
await client2.ensureLogin();
assert.equal(loginPosts.length, 1, 'no second login POST — restored session used');
console.log('restoreSession OK (один вход на два клиента)');

server.close();
fs.rmSync('./test-session', { recursive: true, force: true });
fs.rmSync('./test-api-profile.json', { force: true });
console.log('\nALL TESTS PASSED ✅');
