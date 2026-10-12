import http from 'node:http';
import { ApiClient } from './bot/api.js';
const HTML_LOGIN = `<form action="/auth/login" method="POST"><input type="hidden" name="_token" value="abc123"><input type="email" name="email"><input type="password" name="password"></form>`;
let logins = 0;
const server = http.createServer((req,res)=>{
  const ch=[]; req.on('data',c=>ch.push(c)); req.on('end',()=>{
    if(req.url==='/login') return res.end(HTML_LOGIN);
    if(req.url==='/auth/login'){ logins++; res.statusCode=302; res.setHeader('location','/servers'); res.setHeader('set-cookie','session=S1; Path=/'); return res.end(); }
    if(req.url==='/servers'){
      if(req.headers.cookie?.includes('session=S1'))
        return res.end('<ul><li data-server-id="12345"><a href="/servers/12345">GTAV</a> <span data-status="offline">Выключен</span></li></ul>');
      res.statusCode=302; res.setHeader('location','/login'); return res.end('<html>redirect</html>');
    }
    res.statusCode=404; res.end('nf');
  });
});
await new Promise(r=>server.listen(8747,r));
const cfg={baseUrl:'http://localhost:8747',login:'a@b.c',password:'p',serverId:'12345',sessionSecret:'k'.repeat(64),sessionDir:'./dbg2-session',apiProfile:'./dbg2-profile.json'};
const c=new ApiClient(cfg,console);
// эмулируем ситуацию теста: discover уже сделал loginHttp (сохранил cookies S1 в session-файл)
c.jar.setCookie('session=S1; Path=/','http://localhost:8747/servers');
c.profile={login:{url:'http://localhost:8747/auth/login',method:'POST',userField:'email',passField:'password',csrfField:'_token',csrfValue:'abc123'},serversListUrl:'http://localhost:8747/servers',serverDetailUrl:null,start:null,renew:null};
c.persistSession();
console.log('checkAuth =', await c.checkAuth());
console.log('STATUS =', await c.getStatus(), '| logins:', logins);
server.close();
import fs from 'node:fs'; fs.rmSync('./dbg2-session',{recursive:true,force:true});
