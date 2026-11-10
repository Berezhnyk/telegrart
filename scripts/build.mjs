// Builds dist/widget.html (the exact payload sent to Telegram) and dist/preview.html,
// a local test page that runs the widget on two fake "devices" against a fake bot.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildWidget, MAX_PACKED, MAX_RAW } from '../src/widget.mjs';
import { applyPayload } from '../src/canvas.mjs';

const root = join(import.meta.dirname, '..');
const dist = join(root, 'dist');
const { html, raw, packed } = buildWidget();
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'widget.html'), html);

const codec = readFileSync(join(root, 'src', 'codec.mjs'), 'utf8').replace(/^export /gm, '');

// Runs inside each device iframe before the widget: fakes window.TelegramWidget
// and gives each device its own localStorage, as Telegram does per message per device.
const mock = (dev, theme) => `<script>
const P=parent,H={};
${theme ? `for(const[k,v]of Object.entries(${JSON.stringify(theme)}))document.documentElement.style.setProperty('--tg-theme-'+k,v);` : ''}
Object.defineProperty(window,'localStorage',{value:{getItem:k=>sessionStorage.getItem('${dev}'+k),setItem:(k,v)=>sessionStorage.setItem('${dev}'+k,v)}});
window.TelegramWidget={chatData:P.server.state||null,HapticFeedback:{impactOccurred(){},selectionChanged(){},notificationOccurred(){}},
onEvent(t,f){(H[t]=H[t]||[]).push(f)},ready(){},request:d=>P.server.request(d),emit(t){(H[t]||[]).forEach(f=>f())}};
P.server.clients.push(TelegramWidget);
addEventListener('load',()=>new ResizeObserver(()=>frameElement.style.height=Math.min(600,document.documentElement.scrollHeight)+'px').observe(document.body));
</script>`;

// JSON string literal that is safe inside an inline <script>
const js = (s) => JSON.stringify(s).replace(/<\//g, '<\\/');
const light = { 'bg-color': '#ffffff', 'text-color': '#000000', 'hint-color': '#999999', 'secondary-bg-color': '#efeff4', 'button-color': '#2481cc', 'button-text-color': '#ffffff' };

const preview = `<!doctype html>
<meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>Widget preview</title>
<style>
body{margin:0;padding:16px;background:#0e1621;color:#ccc;font:14px system-ui,sans-serif}
.row{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
iframe{display:block;border:0;border-radius:12px;background:#182533;max-height:600px}
#log img{width:128px;image-rendering:pixelated;background:repeating-conic-gradient(#999 0 25%,#666 0 50%) 0 0/16px 16px;margin:4px}
code{color:#8cf}
</style>
<p>Widget payload: <b>${raw}</b>/${MAX_RAW} bytes raw, <b>${packed}</b>/${MAX_PACKED} compressed. Two devices share one fake bot, so edits sync between them.
<code>server.delay</code> sets the fake latency in ms.</p>
<div class=row>
<div>Phone, dark (330px)<iframe id=a style="width:330px"></iframe></div>
<div>Desktop, light (480px)<iframe id=b style="width:480px"></iframe></div>
<div id=log>Exported PNGs:<br></div>
</div>
<script>
${codec}
${applyPayload.toString()}
var server={state:sessionStorage.getItem('server')||'',clients:[],delay:250,busy:0,
request(q){return new Promise((ok,no)=>setTimeout(()=>{
  const st=dec(server.state)||{W:16,p:Array(256).fill(0)};
  let exp;try{exp=applyPayload(st,q)}catch(e){return no(Object.assign(new Error(e.message),{code:'FAILED'}))}
  server.state=enc(st.W,st.p);sessionStorage.setItem('server',server.state);
  console.log('request',JSON.stringify(q),'->',server.state.length,'bytes');
  for(const c of server.clients)if(c.chatData!==server.state){c.chatData=server.state;c.emit('chatDataChanged')}
  if(exp){const k=8,cv=document.createElement('canvas'),g=cv.getContext('2d');cv.width=cv.height=st.W*k;
   st.p.forEach((v,i)=>{if(v){g.fillStyle='#'+PAL[v-1];g.fillRect(i%st.W*k,(i/st.W|0)*k,k,k)}});
   const img=new Image;img.src=cv.toDataURL();document.getElementById('log').append(img)}
  ok({result:server.state})},server.delay))}};
const W=${js(html)};
a.srcdoc=${js(mock('a', null))}+W;
b.srcdoc=${js(mock('b', light))}+W;
</script>
`;
writeFileSync(join(dist, 'preview.html'), preview);
console.log(`dist/widget.html: ${raw}/${MAX_RAW} bytes raw, ${packed}/${MAX_PACKED} bytes compressed`);
console.log('dist/preview.html: open it in a browser to try the widget locally');
