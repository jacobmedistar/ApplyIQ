import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import * as staff from './api/staff.js';
import * as setup from './api/setup.js';
const endpoints = new Map([['/api/staff',staff],['/api/setup',setup]]);
const assets = {'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/crm.js':['crm.js','text/javascript'],'/style.css':['style.css','text/css'],'/staff.html':['staff.html','text/html'],'/staff.js':['staff.js','text/javascript']};
createServer(async (req,res) => {
  const url = new URL(req.url,'http://localhost');
  const endpoint = endpoints.get(url.pathname);
  if (endpoint) {
    const handler = endpoint[req.method];
    if (!handler) { res.writeHead(405,{'Allow':Object.keys(endpoint).join(', ')}).end(); return; }
    const options = {method:req.method,headers:req.headers};
    if (req.method === 'POST') Object.assign(options,{body:Readable.toWeb(req),duplex:'half'});
    const result = await handler(new Request(url,options));
    res.writeHead(result.status,Object.fromEntries(result.headers)).end(await result.text());
    return;
  }
  const setupAssets = {'/setup.html':['setup.html','text/html'],'/setup.js':['setup.js','text/javascript']};
  const asset = Object.hasOwn(assets,url.pathname) ? assets[url.pathname] :
    Object.hasOwn(setupAssets,url.pathname) && setupAssets[url.pathname];
  if (!asset) { res.writeHead(404).end(); return; }
  const contents = await readFile(new URL('./public/'+asset[0],import.meta.url));
  res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','X-Content-Type-Options':'nosniff'}).end(contents);
}).listen(Number(process.env.PORT || 4173),'127.0.0.1',() => console.log('ApplyIQ: http://127.0.0.1:'+ (process.env.PORT || 4173)));
