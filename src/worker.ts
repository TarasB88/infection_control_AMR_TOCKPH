type Role='admin'|'operator'|'analyst';
type Sheet='Facilities'|'Facility_IPC_Profile'|'IPC_Visits'|'IPC_Assessments'|'Recommendations'|'Legal_Acts'|'Training_Events'|'Training_Facility_Stats'|'AST_Data'|'WGS_Staging'|'Dictionaries'|'Users';
interface Env{ASSETS:{fetch(r:Request):Promise<Response>};GOOGLE_SERVICE_ACCOUNT_EMAIL:string;GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:string;GOOGLE_SPREADSHEET_ID:string;SESSION_SECRET:string;BOOTSTRAP_ADMIN_USERNAME?:string;BOOTSTRAP_ADMIN_PASSWORD_HASH?:string;BOOTSTRAP_ADMIN_DISPLAY_NAME?:string}
interface User{ id:string;username:string;email:string;fullName:string;role:Role;allFacilities:boolean;facilityCodes:string[];mustChangePassword:boolean }
const SHEETS:Sheet[]=['Facilities','Facility_IPC_Profile','IPC_Visits','IPC_Assessments','Recommendations','Legal_Acts','Training_Events','Training_Facility_Stats','AST_Data','WGS_Staging','Dictionaries','Users'];
const te=new TextEncoder(),td=new TextDecoder();
const b64=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const unb64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
const reply=(v:unknown,status=200,headers:Record<string,string>={})=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers}});
const yes=(v:unknown)=>['true','1','yes','так','active'].includes(String(v??'').trim().toLowerCase());
const codes=(v:unknown)=>String(v??'').split(/[;,\n]/).map(x=>x.trim()).filter(Boolean);
const toUser=(r:Record<string,string>):User=>({id:r.User_ID||r.Username||'',username:r.Username||'',email:r.Email||'',fullName:r.Display_Name||r.Username||'',role:(['admin','operator','analyst'].includes(r.Role)?r.Role:'analyst') as Role,allFacilities:yes(r.All_Facilities),facilityCodes:codes(r.Facility_Codes),mustChangePassword:yes(r.Must_Change_Password)});
let tokenCache:{value:string;expires:number}|null=null;
async function googleToken(e:Env){
 if(tokenCache&&tokenCache.expires>Date.now()+60000)return tokenCache.value;
 if(!e.GOOGLE_SERVICE_ACCOUNT_EMAIL||!e.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY||!e.GOOGLE_SPREADSHEET_ID)throw Error('Не налаштовано серверне підключення до Google Sheets.');
 const now=Math.floor(Date.now()/1000),head=b64(te.encode(JSON.stringify({alg:'RS256',typ:'JWT'}))),claim=b64(te.encode(JSON.stringify({iss:e.GOOGLE_SERVICE_ACCOUNT_EMAIL,scope:'https://www.googleapis.com/auth/spreadsheets',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600}))),unsigned=head+'.'+claim;
 const pem=e.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'');
 const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
 const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,te.encode(unsigned)),assertion=unsigned+'.'+b64(new Uint8Array(sig));
 const res=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});
 const d=await res.json() as {access_token?:string;expires_in?:number;error_description?:string};
 if(!res.ok||!d.access_token)throw Error('Google service account: '+(d.error_description||res.status));
 tokenCache={value:d.access_token,expires:Date.now()+(d.expires_in||3600)*1000};return d.access_token;
}
async function gfetch(e:Env,range:string,init:RequestInit={}){
 const t=await googleToken(e),url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(e.GOOGLE_SPREADSHEET_ID)+'/values/'+encodeURIComponent(range);
 const r=await fetch(url,{...init,headers:{Authorization:'Bearer '+t,Accept:'application/json','Content-Type':'application/json',...(init.headers||{})}});
 if(!r.ok)throw Error('Google Sheets API HTTP '+r.status+': '+(await r.text()).slice(0,300));
 return r.status===204?{}:r.json();
}
async function readTable(e:Env,s:Sheet){
 const d=await gfetch(e,"'"+s.replace(/'/g,"''")+"'!A:ZZ") as {values?:unknown[][]},v=d.values||[],headers=(v[0]||[]).map(x=>String(x??'').trim());
 if(!headers.length)return{headers:[],rows:[]};
 if(headers.some(x=>!x)||new Set(headers.map(x=>x.toLowerCase())).size!==headers.length)throw Error('Аркуш '+s+': некоректні або дубльовані заголовки.');
 const rows=v.slice(1).map((a,idx)=>{const o:Record<string,string>={__rowNumber:String(idx+2)};headers.forEach((h,i)=>o[h]=String(a[i]??'').trim());return o;}).filter(o=>headers.some(h=>o[h]!==''));
 return{headers,rows};
}
const col=(n:number)=>{let s='';while(n){const r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;};
async function append(e:Env,s:Sheet,h:string[],rows:unknown[][]){
 if(!rows.length)return;const t=await googleToken(e),range="'"+s+"'!A:"+col(h.length);
 const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(e.GOOGLE_SPREADSHEET_ID)+'/values/'+encodeURIComponent(range)+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
 const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({majorDimension:'ROWS',values:rows})});
 if(!r.ok)throw Error('Не вдалося записати '+s+': HTTP '+r.status+' '+(await r.text()).slice(0,300));
}
async function update(e:Env,s:Sheet,n:number,h:string[],row:unknown[]){
 const t=await googleToken(e),range="'"+s+"'!A"+n+":"+col(h.length)+n,url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(e.GOOGLE_SPREADSHEET_ID)+'/values/'+encodeURIComponent(range)+'?valueInputOption=RAW';
 const r=await fetch(url,{method:'PUT',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({majorDimension:'ROWS',values:[row]})});if(!r.ok)throw Error('Не вдалося оновити користувача: HTTP '+r.status);
}
async function passwordHash(p:string){
 const salt=crypto.getRandomValues(new Uint8Array(16)),material=await crypto.subtle.importKey('raw',te.encode(p),'PBKDF2',false,['deriveBits']),bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:310000},material,256);
 return 'pbkdf2-sha256$310000$'+b64(salt)+'$'+b64(new Uint8Array(bits));
}
async function passwordOK(p:string,stored:string){
 const [scheme,it,salt,hash]=stored.split('$'),n=Number(it);if(scheme!=='pbkdf2-sha256'||!Number.isInteger(n)||n<100000||n>600000||!salt||!hash)return false;
 const material=await crypto.subtle.importKey('raw',te.encode(p),'PBKDF2',false,['deriveBits']),got=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:unb64(salt),iterations:n},material,256)),want=unb64(hash);
 if(got.length!==want.length)return false;let diff=0;for(let i=0;i<got.length;i++)diff|=got[i]^want[i];return diff===0;
}
async function makeSession(u:User,e:Env){
 const body=b64(te.encode(JSON.stringify({u,exp:Date.now()+8*60*60*1000}))),key=await crypto.subtle.importKey('raw',te.encode(e.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']),sig=await crypto.subtle.sign('HMAC',key,te.encode(body));
 return body+'.'+b64(new Uint8Array(sig));
}
async function session(req:Request,e:Env):Promise<User|null>{
 const raw=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('ipc_session='))?.slice(12);if(!raw)return null;
 const [body,sig]=raw.split('.');if(!body||!sig)return null;
 const key=await crypto.subtle.importKey('raw',te.encode(e.SESSION_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 if(!await crypto.subtle.verify('HMAC',key,unb64(sig),te.encode(body)))return null;
 try{const d=JSON.parse(td.decode(unb64(body)));return d.exp>Date.now()?d.u as User:null;}catch{return null;}
}
const cookie=(v:string,age=28800)=>'ipc_session='+v+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age='+age;
const inScope=(u:User,c:string)=>u.allFacilities||u.facilityCodes.includes(c);
function scoped(s:Sheet,rows:Record<string,string>[],u:User){
 if(u.role==='admin'||u.allFacilities||['Legal_Acts','Dictionaries','Training_Events'].includes(s))return rows;
 const fields=s==='Facilities'?['EDRPOU']:s==='AST_Data'||s==='WGS_Staging'?['Hospital_ID']:['Facility_ID','EDRPOU','Hospital_ID'];
 return rows.filter(r=>{const c=fields.map(k=>r[k]).find(Boolean)||'';return !!c&&inScope(u,c);});
}
function mayWrite(u:User,s:Sheet){return u.role!=='analyst'&&(s!=='Users'&&s!=='Facilities'||u.role==='admin');}
async function handle(req:Request,e:Env):Promise<Response>{
 const url=new URL(req.url),p=url.pathname;
 if(p==='/api/health'&&req.method==='GET')return reply({ok:true,storage:'google-sheets'});
 if(p==='/api/auth/login'&&req.method==='POST'){
  const b=await req.json() as {username?:string;password?:string},name=String(b.username||'').trim().toLowerCase(),pass=String(b.password||'');
  if(!name||!pass||pass.length>256)return reply({error:'Введіть логін і пароль.'},400);
  const table=await readTable(e,'Users');
  if(!table.rows.length&&e.BOOTSTRAP_ADMIN_USERNAME&&e.BOOTSTRAP_ADMIN_PASSWORD_HASH){
   if(!table.headers.length)throw Error('Спочатку додайте рядок заголовків до аркуша Users.');
   const now=new Date().toISOString(),r:Record<string,string>={User_ID:crypto.randomUUID(),Username:e.BOOTSTRAP_ADMIN_USERNAME,Email:'',Display_Name:e.BOOTSTRAP_ADMIN_DISPLAY_NAME||'Адміністратор',Password_Hash:e.BOOTSTRAP_ADMIN_PASSWORD_HASH,Role:'admin',All_Facilities:'TRUE',Facility_Codes:'',Is_Active:'TRUE',Must_Change_Password:'TRUE',Created_At:now,Updated_At:now,Last_Login_At:''};
   await append(e,'Users',table.headers,[table.headers.map(h=>r[h]||'')]);table.rows.push(r);
  }
  const r=table.rows.find(x=>String(x.Username||'').trim().toLowerCase()===name);
  if(!r||!yes(r.Is_Active)||!await passwordOK(pass,r.Password_Hash||''))return reply({error:'Неправильний логін або пароль, або обліковий запис неактивний.'},401);
  const idx=Number(r.__rowNumber)||table.rows.indexOf(r)+2;r.Last_Login_At=new Date().toISOString();await update(e,'Users',idx,table.headers,table.headers.map(h=>r[h]??''));
  const u=toUser(r);return reply({user:u},200,{'Set-Cookie':cookie(await makeSession(u,e))});
 }
 if(p==='/api/auth/logout'&&req.method==='POST')return reply({ok:true},200,{'Set-Cookie':cookie('',0)});
 if(p==='/api/auth/me'&&req.method==='GET'){const u=await session(req,e);return u?reply({user:u}):reply({user:null},401);}
 const u=await session(req,e);if(!u)return reply({error:'Потрібно увійти в систему.'},401);
 if(p==='/api/auth/change-password'&&req.method==='POST'){
  const b=await req.json() as {currentPassword?:string;newPassword?:string},current=String(b.currentPassword||''),next=String(b.newPassword||'');
  if(next.length<12||next.length>128)return reply({error:'Новий пароль має містити від 12 до 128 символів.'},400);
  const t=await readTable(e,'Users'),r=t.rows.find(x=>String(x.Username||'').toLowerCase()===u.username.toLowerCase());
  if(!r||!await passwordOK(current,r.Password_Hash||''))return reply({error:'Поточний пароль неправильний.'},401);
  r.Password_Hash=await passwordHash(next);r.Must_Change_Password='FALSE';r.Updated_At=new Date().toISOString();
  await update(e,'Users',Number(r.__rowNumber)||t.rows.indexOf(r)+2,t.headers,t.headers.map(h=>r[h]??''));
  const updated={...u,mustChangePassword:false};return reply({user:updated},200,{'Set-Cookie':cookie(await makeSession(updated,e))});
 }

 const m=p.match(/^\/api\/sheets\/([A-Za-z_]+)$/);
 if(m){
  const s=m[1] as Sheet;if(!SHEETS.includes(s))return reply({error:'Невідомий аркуш.'},404);
  if(s==='Users'&&u.role!=='admin')return reply({error:'Недостатньо прав.'},403);
  if(req.method==='GET'){
   const t=await readTable(e,s),headers=t.headers.filter(h=>h!=='Password_Hash'&&h!=='Password'),rows=s==='Users'?t.rows.map(r=>{const x={...r};delete x.Password_Hash;delete x.Password;delete x.__rowNumber;return x;}):scoped(s,t.rows,u).map(r=>{const x={...r};delete x.__rowNumber;return x;});
   return reply({headers,rows});
  }
  if(req.method==='POST'){
   if(!mayWrite(u,s))return reply({error:'Недостатньо прав для запису.'},403);
   const b=await req.json() as {headers?:string[];rows?:unknown[][]};if(!Array.isArray(b.headers)||!Array.isArray(b.rows))return reply({error:'Некоректний формат запису.'},400);
   if(b.headers.some(h=>h==='Password'||h==='Password_Hash'))return reply({error:'Пароль можна змінювати лише через адміністрування.'},400);
   if(u.role!=='admin'&&!u.allFacilities)for(const row of b.rows){const k=s==='Facilities'?'EDRPOU':s==='AST_Data'||s==='WGS_Staging'?'Hospital_ID':'Facility_ID',i=b.headers.indexOf(k);if(i<0||!inScope(u,String(row[i]??'')))return reply({error:'Запис поза межами дозволених закладів.'},403);}
   await append(e,s,b.headers,b.rows);return reply({ok:true});
  }
 }
 if(p==='/api/admin/users'&&req.method==='POST'){
  if(u.role!=='admin')return reply({error:'Лише адміністратор може створювати користувачів.'},403);
  const b=await req.json() as {username?:string;password?:string;email?:string;displayName?:string;role?:Role;allFacilities?:boolean;facilityCodes?:string[];isActive?:boolean};
  const username=String(b.username||'').trim().toLowerCase(),pass=String(b.password||'');
  if(!/^[a-z0-9._-]{3,40}$/.test(username))return reply({error:'Логін має містити 3–40 символів латиниці, цифр, крапки, дефіса або підкреслення.'},400);
  if(pass.length<12||pass.length>128)return reply({error:'Початковий пароль має містити від 12 до 128 символів.'},400);
  if(!['admin','operator','analyst'].includes(String(b.role)))return reply({error:'Невідома роль.'},400);
  const t=await readTable(e,'Users');if(!t.headers.length)return reply({error:'У Users відсутній рядок заголовків.'},400);
  if(t.rows.some(r=>String(r.Username||'').toLowerCase()===username))return reply({error:'Такий логін уже існує.'},409);
  const now=new Date().toISOString(),r:Record<string,string>={User_ID:crypto.randomUUID(),Username:username,Email:String(b.email||''),Display_Name:String(b.displayName||username),Password_Hash:await passwordHash(pass),Role:String(b.role),All_Facilities:b.allFacilities?'TRUE':'FALSE',Facility_Codes:(b.facilityCodes||[]).join(';'),Is_Active:b.isActive===false?'FALSE':'TRUE',Must_Change_Password:'TRUE',Created_At:now,Updated_At:now,Last_Login_At:'',Notes:''};
  await append(e,'Users',t.headers,[t.headers.map(h=>r[h]??'')]);return reply({ok:true},201);
 }
 return reply({error:'Маршрут не знайдено.'},404);
}
export default {async fetch(req:Request,e:Env){
 const url=new URL(req.url);if(url.pathname.startsWith('/api/')){
  if(req.method!=='GET'&&req.headers.get('Origin')&&req.headers.get('Origin')!==url.origin)return reply({error:'Недійсне джерело запиту.'},403);
  if(!e.SESSION_SECRET)return reply({error:'Не налаштовано SESSION_SECRET у Cloudflare Worker.'},503);
  try{return await handle(req,e);}catch(err){return reply({error:err instanceof Error?err.message:'Внутрішня помилка сервера.'},500);}
 }return e.ASSETS.fetch(req);
}};
