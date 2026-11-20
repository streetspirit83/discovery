// Holt je US-Titel Yahoo-Ereignisse und Tageskurse; Ergebnis liegt zwischengespeichert unter raw/.
import fs from 'node:fs';
const U=JSON.parse(fs.readFileSync('universe.json'));
const US=new Set(['NASDAQ','NYSE','AMEX','NYSEARCA','NYSE ARCA','OTC','BATS']);
const list=U.filter(s=>US.has(String(s.exchange).toUpperCase()));
fs.mkdirSync('raw',{recursive:true});
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const r0=await fetch('https://fc.yahoo.com/',{headers:{'User-Agent':UA},redirect:'manual'}).catch(e=>e);
const cookie=(r0.headers?.getSetCookie?.()??[]).map(c=>c.split(';')[0]).join('; ');
const crumb=await (await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb',{headers:{'User-Agent':UA,cookie}})).text();
console.log('crumb',crumb.length,'titles',list.length);
const H={'User-Agent':UA,cookie,Origin:'https://finance.yahoo.com',Referer:'https://finance.yahoo.com/'};
const get=async(u)=>{for(let i=0;i<3;i++){const r=await fetch(u,{headers:H});if(r.status===429){await new Promise(x=>setTimeout(x,3000*(i+1)));continue;}return r.ok?r.json():null;}return null;};
async function one(sym){const f=`raw/${sym}.json`;if(fs.existsSync(f))return true;
 const y=sym.replace('.','-');
 const q=await get(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${y}?modules=upgradeDowngradeHistory,earningsHistory&crumb=${encodeURIComponent(crumb)}`);
 const c=await get(`https://query1.finance.yahoo.com/v8/finance/chart/${y}?range=10y&interval=1d&events=earnings`);
 const r=c?.chart?.result?.[0]; if(!r?.timestamp)return false;
 const a=r.indicators?.adjclose?.[0]?.adjclose; 
 fs.writeFileSync(f,JSON.stringify({events:q?.quoteSummary?.result?.[0]?.upgradeDowngradeHistory?.history??[],t:r.timestamp,c:a,o:r.indicators.quote[0].open,cl:r.indicators.quote[0].close,ev:r.events??null}));return true;}
let ok=0,fail=[];const syms=[...new Set(list.map(s=>s.symbol)),'SPY','QQQ'];
for(let i=0;i<syms.length;i+=5){const b=syms.slice(i,i+5);const rs=await Promise.all(b.map(s=>one(s).catch(()=>false)));rs.forEach((x,j)=>x?ok++:fail.push(b[j]));if(i%50===0)console.log(i,ok);await new Promise(x=>setTimeout(x,300));}
console.log('done',ok,'fail',fail.length,fail.slice(0,20).join(','));
