import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const assets = {'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/crm.js':['crm.js','text/javascript'],'/style.css':['style.css','text/css']};
createServer(async (req,res) => {
  const asset = assets[new URL(req.url,'http://localhost').pathname];
  if (!asset) { res.writeHead(404).end(); return; }
  const contents = await readFile(new URL('./public/'+asset[0],import.meta.url));
  res.writeHead(200,{'Content-Type':asset[1]+'; charset=utf-8','X-Content-Type-Options':'nosniff'}).end(contents);
}).listen(Number(process.env.PORT || 4173),'127.0.0.1',() => console.log('ApplyIQ: http://127.0.0.1:'+ (process.env.PORT || 4173)));
