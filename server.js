import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import * as staff from './api/staff.js';
const assets = {'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/crm.js':['crm.js','text/javascript'],'/style.css':['style.css','text/css'],'/staff.html':['staff.html','text/html'],'/staff.js':['staff.js','text/javascript']};
createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  if (url.pathname === '/api/staff') {
    const handler = staff[req.method];
    if (!handler) { res.writeHead(405,{'Allow':'GET, POST'}).end(); return; }
    const options = {method:req.method,headers:req.headers};
    if (req.method === 'POST') Object.assign(options,{body:Readable.toWeb(req),duplex:'half'});
    const result = await handler(new Request(url,options));
    res.writeHead(result.status,Object.fromEntries(result.headers)).end(await result.text());
    return;
  }
  const asset = Object.hasOwn(assets,url.pathname) && assets[url.pathname];
  if (!asset) { res.writeHead(404).end(); return; }
  const contents = await readFile(new URL('./public/'+asset[0],import.meta.url));
  res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','X-Content-Type-Options':'nosniff'}).end(contents);
}).listen(Number(process.env.PORT || 4173),'127.0.0.1',() => console.log('ApplyIQ: http://127.0.0.1:'+ (process.env.PORT || 4173)));
