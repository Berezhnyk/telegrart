// Shared between the bot (imported as a module) and the widget (inlined into the
// HTML at build time with `export ` stripped). Keep it compact: every byte here
// counts against the widget's 4096-byte compressed budget.
//
// Image state  = A[W] + pixels bit-packed 5 bits each into base64url chars.
//                Pixel 0 is transparent, 1..16 index PAL. 32x32 -> 855 bytes (limit 1024).
// Sync payload = ['!'] + A[W] + runs, run = idx(2 chars) len-1(2 chars) color(1 char).
//                '!' asks the bot to also send the picture as a PNG. Max 12 runs -> <= 62 bytes.
export const A='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
PAL='000000 1d2b53 7e2553 008751 ab5236 5f574f c2c3c7 fff1e8 ff004d ffa300 ffec27 00e436 29adff 83769c ff77a8 ffccaa'.split(' ');
export function crop(p,w,W){let a=Array(W*W).fill(0),m=Math.min(w,W);for(let j=0;j<m;j++)for(let i=0;i<m;i++)a[j*W+i]=p[j*w+i]||0;return a}
export function enc(W,p){let s=A[W],a=0,n=0;for(let v of p){a=a<<5|v;n+=5;if(n>5){n-=6;s+=A[a>>n&63]}a&=(1<<n)-1}return n?s+A[a<<6-n&63]:s}
export function dec(s){let W=s?A.indexOf(s[0]):0,N=W*W,p=[],a=0,n=0;if(W<1||W>32)return;for(let i=1;i<s.length&&p.length<N;i++){a=a<<6|A.indexOf(s[i]);n+=6;while(n>4&&p.length<N){n-=5;p.push(a>>n&31)}a&=(1<<n)-1}while(p.length<N)p.push(0);return{W,p}}
export function diff(b,p,W,m=12){let r='',i=0,j,c,N=W*W,h=n=>A[n>>6]+A[n&63];for(;i<N;i++)if(b[i]!=p[i]){if(!m--)return[r,0];c=p[i];for(j=i+1;j<N&&p[j]==c;j++);r+=h(i)+h(j-i-1)+A[c];i=j-1}return[r,1]}
