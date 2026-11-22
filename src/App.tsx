import type { FormEvent } from 'react';
import { useMemo, useRef, useState } from 'react';
import { Activity, AlertCircle, ArrowDownToLine, ArrowUpFromLine, BadgeCheck, Building2, CalendarDays, ClipboardCheck, Dna, FileSpreadsheet, FlaskConical, LayoutDashboard, LogOut, Menu, Microscope, Plus, Search, ShieldCheck, Users, X } from 'lucide-react';
import * as XLSX from 'xlsx';
import { AmrMap } from './components/AmrMap';
import { COMMUNITY_SHAPES } from './lib/community-shapes';
import { DISTRICT_SHAPES } from './lib/map-shapes';
import {
  appendSheetRows, clearGoogleSession, createMissingSheetTabs, getGoogleProfile, getSpreadsheetTabs,
  googleClientConfigured, GOOGLE_SHEET_TABS, readSheetTable, selectSpreadsheetWithPicker, signInWithGoogle,
  type GoogleProfile, type GoogleSheetTab, type SheetRecord,
} from './lib/google-sheets';

type Tab = 'overview'|'facilities'|'visits'|'ipc'|'training'|'amr'|'wgs'|'recommendations'|'imports'|'legal'|'users';
type Role = 'admin'|'operator'|'analyst';
type AppUser = { id:string; email:string; fullName:string; role:Role; isActive:boolean; allFacilities:boolean; facilityCodes:string[] };
type SheetState = { headers:string[]; rows:SheetRecord[] };
type AstRow = { Hospital_ID:string; Hospital_Name:string; Region_Oblast:string; Territorial_Hromada:string; Settlement:string; Patient_ID:string; Sample_ID:string; Sampling_Date:string; Sample_Matrix_Type:string; Bacterial_Species:string; Antimicrobial_Agent:string; MIC_Operator:string; MIC_Value:string; Zone_Diameter:string; SIR_Category:string; Interpretation_Standard:string };
const AST_HEADERS = ['Hospital_ID','Hospital_Name','Region_Oblast','Territorial_Hromada','Settlement','Patient_ID','Sample_ID','Sampling_Date','Sample_Matrix_Type','Bacterial_Species','Antimicrobial_Agent','MIC_Operator','MIC_Value','Zone_Diameter','SIR_Category','Interpretation_Standard'];
const USER_HEADERS = ['Google_Sub','Email','Full_Name','Role','Is_Active','All_Facilities','Facility_Codes','Created_At','Updated_At'];
const DEFAULT_HEADERS:Record<GoogleSheetTab,string[]> = {
  Facilities:['EDRPOU','Name','Region_Oblast','District','Territorial_Hromada','Settlement','Address','Ownership','Care_Level','Network_Status','Monitoring_Years'],
  Facility_IPC_Profile:['Facility_ID','Facility_Name','Profile_Date','VIK_Unit','VIK_Staff_Count','VIK_FTE_Count','IPC_Program','Notes'],
  IPC_Visits:['Visit_ID','Facility_ID','Facility_Name','Planned_Month','Visit_Date','Responsible_Person','Status','Summary','Created_At'],
  IPC_Assessments:['Assessment_ID','Facility_ID','Facility_Name','Visit_Date','Criterion_Code','Criterion_Name','Result','Score','Comment','Assessed_By','Created_At'],
  Recommendations:['Recommendation_ID','Facility_ID','Visit_ID','Description','Responsible_Person','Due_Date','Status','Completion_Note','Created_At','Updated_At'],
  Legal_Acts:['Act_ID','Title','Document_Number','Document_Date','Source_URL','Status','Effective_From','Checked_At','Next_Review_Date','Responsible','Notes'],
  Training_Events:['Event_ID','Date','Title','Format','Organizer','Audience','Facilities','Participants','Hours','Assessed','Average_Score','Outcome','Notes','Created_By','Created_At'],
  Training_Facility_Stats:['Event_ID','Facility_ID','Facility_Name','Participants','Staff_Category','Notes'],
  AST_Data:AST_HEADERS,
  WGS_Staging:['WGS_ID','Hospital_ID','Hospital_Name','Sample_ID','Isolate_ID','Sequencing_Date','Sequencing_Platform','MLST_ST','Serotype_K_O_Antigen','AMR_Genotype_Genes','Point_Mutations','Virulence_Genes','Plasmid_Replicon_Type','FASTA_FASTQ_File_Link','Notes','Created_By','Created_At'],
  Dictionaries:['Dictionary','Code','Label','Parent_Code','Is_Active','Notes'],
  Users:USER_HEADERS,
};
const SHEET_BY_TAB:Partial<Record<Tab,GoogleSheetTab>> = {
  facilities:'Facilities', visits:'IPC_Visits', ipc:'IPC_Assessments', training:'Training_Events',
  amr:'AST_Data', wgs:'WGS_Staging', recommendations:'Recommendations', legal:'Legal_Acts', users:'Users',
};
const TAB_LABELS:Record<Tab,string> = {
  overview:'Огляд системи',facilities:'Реєстр закладів',visits:'Моніторингові візити',ipc:'Оцінювання IPC',
  training:'Навчальні заходи',amr:'Моніторинг AST',wgs:'Геномний нагляд WGS',recommendations:'Рекомендації',
  imports:'Імпорт даних',legal:'Моніторинг НПА',users:'Користувачі та доступ',
};
const REQUIRED_AST:(keyof AstRow)[] = AST_HEADERS.filter(field => !['Patient_ID','MIC_Operator','MIC_Value','Zone_Diameter'].includes(field)) as (keyof AstRow)[];
const norm=(value:string)=>value.toLocaleLowerCase('uk').replace(/[’'"_\s-]/g,'').replace(/[^a-zа-яіїєґ0-9]/gi,'');
const getCell=(record:SheetRecord,names:string[],fallback='')=>{
  for(const name of names){
    const key=norm(name);
    const found=Object.entries(record).find(([header])=>norm(header)===key);
    if(found)return String(found[1]??'').trim();
  }
  return fallback;
};
const parseAst=(record:SheetRecord):AstRow=>Object.fromEntries(AST_HEADERS.map(key=>[key,getCell(record,[key])])) as unknown as AstRow;
const parseUser=(record:SheetRecord):AppUser=>({
  id:getCell(record,['Google_Sub','Google_Subject','Google_ID'])||getCell(record,['Email']).toLowerCase(),
  email:getCell(record,['Email']).toLowerCase(),
  fullName:getCell(record,['Full_Name','ПІБ'])||getCell(record,['Email']),
  role:(['admin','operator','analyst'].includes(getCell(record,['Role']).toLowerCase())?getCell(record,['Role']).toLowerCase():'analyst') as Role,
  isActive:getCell(record,['Is_Active'])===''||['true','1','yes','так','active'].includes(getCell(record,['Is_Active']).toLowerCase()),
  allFacilities:['true','1','yes','так'].includes(getCell(record,['All_Facilities']).toLowerCase()),
  facilityCodes:getCell(record,['Facility_Codes']).split(/[;,\n]/).map(v=>v.trim()).filter(Boolean),
});
const facility=(r:SheetRecord)=>({
  edrpou:getCell(r,['EDRPOU','ЄДРПОУ','Hospital_ID']),
  name:getCell(r,['Name','Назва','Hospital_Name']),
  oblast:getCell(r,['Region_Oblast','Область']),district:getCell(r,['District','Район']),
  hromada:getCell(r,['Territorial_Hromada','Громада']),settlement:getCell(r,['Settlement','Населений пункт']),
  address:getCell(r,['Address','Адреса']),ownership:getCell(r,['Ownership','Форма власності']),
  care_level:getCell(r,['Care_Level','Рівень допомоги']),network_status:getCell(r,['Network_Status','Спроможна мережа']),
  monitoring_years:getCell(r,['Monitoring_Years','Роки моніторингу']),
});
const mapArea=(value:string)=>value.toLocaleLowerCase('uk').replace(/(територіальна громада|міська громада|селищна громада|сільська громада|отг|громада)/g,'').replace(/[^а-яіїєґa-z0-9]/gi,'').trim();

export default function App(){
  const [tab,setTab]=useState<Tab>('overview');
  const [mobile,setMobile]=useState(false);
  const [user,setUser]=useState<AppUser|null>(null);
  const [googleProfile,setGoogleProfile]=useState<GoogleProfile|null>(null);
  const [authLoading,setAuthLoading]=useState(false);
  const [authError,setAuthError]=useState('');
  const [notice,setNotice]=useState('Увійдіть через Google, щоб підключити робочу книгу.');
  const [sheets,setSheets]=useState<Partial<Record<GoogleSheetTab,SheetState>>>({});
  const [loading,setLoading]=useState(false);
  const [query,setQuery]=useState('');
  const [facilityQuery,setFacilityQuery]=useState('');
  const [draft,setDraft]=useState<SheetRecord>({});
  const [showForm,setShowForm]=useState(false);
  const [saving,setSaving]=useState(false);
  const [selectedDistrict,setSelectedDistrict]=useState('all');
  const [selectedCommunity,setSelectedCommunity]=useState('all');
  const fileRef=useRef<HTMLInputElement>(null);
  const title=TAB_LABELS[tab];
  const activeSheet=SHEET_BY_TAB[tab];
  const current=sheets[activeSheet||'AST_Data']||{headers:[],rows:[]};
  const visibleRows=useMemo(()=>current.rows.filter(row=>Object.values(row).join(' ').toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk'))),[current.rows,query]);
  const facilities=(sheets.Facilities?.rows||[]).map(facility).filter(row=>row.edrpou||row.name);
  const visibleFacilities=facilities.filter(row=>Object.values(row).join(' ').toLocaleLowerCase('uk').includes(facilityQuery.toLocaleLowerCase('uk')));
  const astRows=(sheets.AST_Data?.rows||[]).map(parseAst);
  const filteredAst=astRows.filter(row=>Object.values(row).join(' ').toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk')));
  const communities=useMemo(()=>COMMUNITY_SHAPES.map(shape=>{const matched=filteredAst.filter(row=>mapArea(row.Territorial_Hromada)===mapArea(shape.name));return{name:shape.name,total:matched.length,samples:new Set(matched.map(row=>row.Sample_ID)).size,resistant:matched.filter(row=>row.SIR_Category.toUpperCase()==='R').length};}),[filteredAst]);
  const districts=useMemo(()=>DISTRICT_SHAPES.map(shape=>{const names=COMMUNITY_SHAPES.filter(c=>c.district===shape.name).map(c=>mapArea(c.name));const matched=filteredAst.filter(row=>names.includes(mapArea(row.Territorial_Hromada)));return{name:shape.name,total:matched.length,samples:new Set(matched.map(row=>row.Sample_ID)).size,resistant:matched.filter(row=>row.SIR_Category.toUpperCase()==='R').length};}),[filteredAst]);

  const ensureWorkbook=async()=>{
    await createMissingSheetTabs([...GOOGLE_SHEET_TABS]);
    const loaded:Partial<Record<GoogleSheetTab,SheetState>>={};
    const missing:string[]=[];
    for(const name of GOOGLE_SHEET_TABS){
      let table=await readSheetTable(name);
      if(!table.headers.length){
        const headers=DEFAULT_HEADERS[name];
        await appendSheetRows(name,headers,[headers]);
        table={headers,rows:[]};
        missing.push(name);
      }
      loaded[name]=table;
    }
    setSheets(loaded);
    return missing;
  };

  const signIn=async()=>{
    setAuthLoading(true);setAuthError('');
    try{
      await signInWithGoogle();
      const profile=await getGoogleProfile();
      const selectedWorkbook=await selectSpreadsheetWithPicker();
      const existingTabs=await getSpreadsheetTabs();
      if(!existingTabs.includes('Users'))await createMissingSheetTabs(['Users']);
      let users=await readSheetTable('Users');
      if(!users.headers.length){
        await appendSheetRows('Users',USER_HEADERS,[USER_HEADERS]);
        users={headers:USER_HEADERS,rows:[]};
      }
      if(!users.rows.length){
        const bootstrap:SheetRecord={Google_Sub:profile.sub,Email:profile.email.toLowerCase(),Full_Name:profile.name||profile.email,Role:'admin',Is_Active:'TRUE',All_Facilities:'TRUE',Facility_Codes:'',Created_At:new Date().toISOString(),Updated_At:new Date().toISOString()};
        await appendSheetRows('Users',users.headers,[users.headers.map(h=>getCell(bootstrap,[h]))]);
        users=await readSheetTable('Users');
      }
      const record=users.rows.find(row=>getCell(row,['Email']).toLowerCase()===profile.email.toLowerCase()&&(!getCell(row,['Google_Sub'])||getCell(row,['Google_Sub'])===profile.sub));
      if(!record)throw new Error('Google-акаунт '+profile.email+' не зареєстрований в аркуші Users. Додайте email та призначте роль.');
      const appUser=parseUser(record);
      if(!appUser.isActive)throw new Error('Обліковий запис деактивовано адміністратором.');
      setGoogleProfile(profile);setUser(appUser);
      await ensureWorkbook();
      setAuthError('');
      setNotice('Підключено Google Sheets · '+selectedWorkbook.name+' · '+profile.email+'. Вибрано саме цю книгу через Google Picker.');
      setTab('overview');
    }catch(error){
      clearGoogleSession();setUser(null);setGoogleProfile(null);
      setAuthError(error instanceof Error?error.message:'Не вдалося підключити Google Sheets.');
    }finally{setAuthLoading(false);}
  };

  const refreshAll=async()=>{
    setLoading(true);
    try{
      const loaded:Partial<Record<GoogleSheetTab,SheetState>>={};
      for(const name of GOOGLE_SHEET_TABS){
        const table=await readSheetTable(name);
        loaded[name]=table;
      }
      setSheets(loaded);
      setNotice('Оновлено всі '+GOOGLE_SHEET_TABS.length+' аркушів Google Sheets.');
    }catch(error){setNotice('Не вдалося оновити Google Sheets: '+(error instanceof Error?error.message:String(error)));}
    finally{setLoading(false);}
  };

  const signOut=()=>{
    clearGoogleSession();setUser(null);setGoogleProfile(null);setSheets({});setTab('overview');
    setNotice('Сеанс Google завершено.');
  };

  const saveRecord=async(sheet:GoogleSheetTab,record:SheetRecord)=>{
    const table=sheets[sheet];
    if(!table?.headers.length)throw new Error('Не знайдено заголовки колонок на аркуші '+sheet+'.');
    const values=table.headers.map(header=>record[header]??'');
    await appendSheetRows(sheet,table.headers,[values]);
    const updated=await readSheetTable(sheet);
    setSheets(previous=>({...previous,[sheet]:updated}));
  };

  const addGenericRecord=async(event:FormEvent)=>{
    event.preventDefault();
    if(!activeSheet)return;
    setSaving(true);
    try{
      await saveRecord(activeSheet,draft);
      setDraft({});setShowForm(false);setNotice('Новий запис додано до аркуша '+activeSheet+'.');
    }catch(error){setNotice('Не вдалося записати дані: '+(error instanceof Error?error.message:String(error)));}
    finally{setSaving(false);}
  };

  const importAst=async(file?:File)=>{
    if(!file)return;
    setSaving(true);
    try{
      const workbook=XLSX.read(await file.arrayBuffer(),{type:'array'});
      const worksheet=workbook.Sheets[workbook.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json<SheetRecord>(worksheet,{defval:''});
      if(!raw.length)throw new Error('У файлі немає рядків даних.');
      if(tab==='wgs'){
        const table=sheets.WGS_Staging;
        if(!table?.headers.length)throw new Error('Аркуш WGS_Staging не має заголовків.');
        const sourceHeaders=Object.keys(raw[0]||{});
        const requiredWgs=['Sample_ID','Isolate_ID','Sequencing_Date','Sequencing_Platform'];
        const missing=requiredWgs.filter(header=>!sourceHeaders.some(key=>norm(key)===norm(header)));
        if(missing.length)throw new Error('У WGS Excel відсутні обов’язкові колонки: '+missing.join(', '));
        const rows=raw.map((record,index)=>{
          const normalized=Object.fromEntries(Object.entries(record).map(([key,value])=>[norm(key),String(value??'')]));
          if(!normalized.sampleid||!normalized.isolateid||!normalized.sequencingdate||!normalized.sequencingplatform){
            throw new Error('Рядок '+(index+2)+': Sample_ID, Isolate_ID, Sequencing_Date та Sequencing_Platform обов’язкові.');
          }
          return table.headers.map(header=>normalized[norm(header)]??'');
        });
        await appendSheetRows('WGS_Staging',table.headers,rows);
        const updated=await readSheetTable('WGS_Staging');
        setSheets(previous=>({...previous,WGS_Staging:updated}));
        setNotice('Імпортовано '+rows.length+' результатів WGS безпосередньо до Google Sheets.');
        setTab('wgs');
        return;
      }
      const sourceHeaders=Object.keys(raw[0]||{});
      const missing=AST_HEADERS.filter(header=>!sourceHeaders.some(key=>norm(key)===norm(header)));
      if(missing.length)throw new Error('В Excel відсутні обов’язкові колонки: '+missing.join(', '));
      const normalized=raw.map(item=>{
        const row=parseAst(Object.fromEntries(Object.entries(item).map(([k,v])=>[k,String(v??'')])));
        if(REQUIRED_AST.some(key=>!row[key]))throw new Error('Є рядок без обов’язкового поля '+REQUIRED_AST.find(key=>!row[key])+'.');
        if(row.SIR_Category&&!['S','I','R'].includes(row.SIR_Category.toUpperCase()))throw new Error('SIR_Category має містити S, I або R.');
        row.SIR_Category=row.SIR_Category.toUpperCase();
        return row;
      });
      const table=sheets.AST_Data;
      if(!table?.headers.length)throw new Error('Аркуш AST_Data не має заголовків.');
      await appendSheetRows('AST_Data',table.headers,normalized.map(row=>table.headers.map(header=>String((row as unknown as SheetRecord)[header]??''))));
      const updated=await readSheetTable('AST_Data');
      setSheets(previous=>({...previous,AST_Data:updated}));
      setNotice('Імпортовано '+normalized.length+' результатів безпосередньо до Google Sheets.');
      setTab('amr');
    }catch(error){setNotice('Імпорт відхилено: '+(error instanceof Error?error.message:String(error)));}
    finally{setSaving(false);}
  };

  const exportAst=()=>{
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(astRows),'AMR_AST');
    XLSX.writeFile(workbook,'AMR_AST_export.xlsx');
  };

  const addUser=async(event:FormEvent)=>{
    event.preventDefault();
    if(!user||user.role!=='admin')return;
    const table=sheets.Users;
    if(!table?.headers.length)throw new Error('Аркуш Users не має заголовків.');
    const email=String(draft.Email||'').trim().toLowerCase();
    if(!email)throw new Error('Email обов’язковий.');
    if(table.rows.some(row=>getCell(row,['Email']).toLowerCase()===email))throw new Error('Користувач з таким email уже є.');
    const row:SheetRecord={Google_Sub:'',Email:email,Full_Name:String(draft.Full_Name||''),Role:String(draft.Role||'analyst'),Is_Active:String(draft.Is_Active||'TRUE'),All_Facilities:String(draft.All_Facilities||'FALSE'),Facility_Codes:String(draft.Facility_Codes||''),Created_At:new Date().toISOString(),Updated_At:new Date().toISOString()};
    await saveRecord('Users',row);
    setDraft({});setShowForm(false);setNotice('Додано профіль '+email+'. Надалі потрібно надати цьому акаунту доступ до Google-книги у Drive.');
  };

  const downloadAstTemplate=()=>{
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([AST_HEADERS]),'AST_Data');
    XLSX.writeFile(workbook,'AST_Data_template.xlsx');
  };

  if(!user){
    return <div className="authscreen"><div className="authcard"><ShieldCheck/><h1>IPC & AMR Monitoring</h1>
      {authLoading?<p>Підключення Google Sheets…</p>:<><p>{authError||'Увійдіть через Google, щоб працювати з єдиною книгою IPC та AMR.'}</p>
      <button className="primary" disabled={!googleClientConfigured()} onClick={()=>void signIn()}>{googleClientConfigured()?'Увійти через Google':'Потрібно налаштувати OAuth Client ID'}</button>
      {!googleClientConfigured()&&<small>Збірці потрібен публічний VITE_GOOGLE_CLIENT_ID. Це ідентифікатор OAuth-застосунку, не секрет і не пароль.</small>}
      <small>Google-акаунт повинен мати доступ до робочої книги в Google Drive. Після входу роль перевіряється за аркушем Users.</small></>}
    </div></div>;
  }

  const nav:Array<{id:Tab;label:string;icon:any;group:string}>=[
    {id:'overview',label:'Огляд системи',icon:LayoutDashboard,group:'РОБОЧА ПАНЕЛЬ'},
    {id:'facilities',label:'Реєстр закладів',icon:Building2,group:'РОБОЧА ПАНЕЛЬ'},
    {id:'visits',label:'Моніторингові візити',icon:CalendarDays,group:'ІНФЕКЦІЙНИЙ КОНТРОЛЬ'},
    {id:'ipc',label:'Оцінювання IPC',icon:ClipboardCheck,group:'ІНФЕКЦІЙНИЙ КОНТРОЛЬ'},
    {id:'training',label:'Навчальні заходи',icon:Users,group:'ІНФЕКЦІЙНИЙ КОНТРОЛЬ'},
    {id:'amr',label:'Моніторинг AST',icon:Microscope,group:'ЛАБОРАТОРНИЙ НАГЛЯД'},
    {id:'wgs',label:'Геномний нагляд WGS',icon:Dna,group:'ЛАБОРАТОРНИЙ НАГЛЯД'},
    {id:'recommendations',label:'Рекомендації',icon:BadgeCheck,group:'ІНСТРУМЕНТИ'},
    {id:'legal',label:'Моніторинг НПА',icon:FileSpreadsheet,group:'НОРМАТИВНО-ПРАВОВА БАЗА'},
    {id:'imports',label:'Імпорт даних',icon:ArrowUpFromLine,group:'ІНСТРУМЕНТИ'},
    {id:'users',label:'Користувачі та доступ',icon:Users,group:'АДМІНІСТРУВАННЯ'},
  ];
  const activeHeaders=activeSheet?sheets[activeSheet]?.headers||[]:[];
  const canWrite=user.role!=='analyst';
  const addForm=(sheet:GoogleSheetTab)=>{setDraft(Object.fromEntries((sheets[sheet]?.headers||[]).map(h=>[h,''])));setShowForm(true);};
  const activeRecords=activeSheet?sheets[activeSheet]?.rows||[]:[];
  const selectedFacilities=activeSheet==='Facilities'?visibleFacilities:[];

  return <div className="shell">
    <aside className={'sidebar '+(mobile?'open':'')}>
      <div className="brand"><div className="brandmark"><ShieldCheck/></div><div><b>ТЕРНОПІЛЬСЬКИЙ ОЦКПХ</b><small>IPC & AMR MONITORING</small></div><button className="close" onClick={()=>setMobile(false)}><X/></button></div>
      <div className="sideintro">ІНФОРМАЦІЙНО-АНАЛІТИЧНА СИСТЕМА</div>
      {['РОБОЧА ПАНЕЛЬ','ІНФЕКЦІЙНИЙ КОНТРОЛЬ','ЛАБОРАТОРНИЙ НАГЛЯД','ІНСТРУМЕНТИ','НОРМАТИВНО-ПРАВОВА БАЗА','АДМІНІСТРУВАННЯ'].map(group=><div className="navgroup" key={group}><label>{group}</label>{nav.filter(item=>item.group===group&&(item.id!=='users'||user.role==='admin')).map(item=><button key={item.id} className={'nav '+(tab===item.id?'active':'')} onClick={()=>{setTab(item.id);setMobile(false);setShowForm(false);setQuery('');}}><item.icon size={17}/>{item.label}</button>)}</div>)}
      <div className="sidebottom"><ShieldCheck size={16}/> Google Sheets · пряме підключення<small>{user.email}</small></div>
    </aside>
    <main>
      <header className="topbar"><button className="hamb" onClick={()=>setMobile(true)}><Menu/></button><div>IPC & AMR <span>/</span> {title}</div><div className="topright"><em>GOOGLE SHEETS</em><b>{(googleProfile?.name||user.fullName||'G').slice(0,1)}</b><button className="btn" onClick={signOut}><LogOut size={15}/> Вийти</button></div></header>
      <div className="page">
        <div className="pagehead"><div><label>ТЕРНОПІЛЬСЬКИЙ ОБЛАСНИЙ ЦЕНТР КОНТРОЛЮ ТА ПРОФІЛАКТИКИ ХВОРОБ МОЗ УКРАЇНИ</label><h1>{tab==='overview'?'Моніторинг інфекційного контролю та AMR':title}</h1><p>{tab==='overview'?'Єдиний робочий простір. Усі робочі аркуші підключені безпосередньо до Google Sheets.':'Джерело даних: головна Google-книга IPC & AMR.'}</p></div><button className="btn" onClick={()=>void refreshAll()} disabled={loading}><ArrowDownToLine size={16}/>{loading?'Оновлення…':'Оновити всі дані'}</button></div>
        <div className="notice"><AlertCircle size={17}/>{notice}</div>
        {tab==='overview'&&<><div className="section"><div><h2>Робочий огляд</h2><p>Кількість записів безпосередньо в Google Sheets</p></div><span className="pill">LIVE GOOGLE SHEETS</span></div><div className="metrics">{GOOGLE_SHEET_TABS.map(name=><div className="metric" key={name}><small>{name}</small><b>{sheets[name]?.rows.length??0}</b><span>рядків даних</span></div>)}</div><div className="modules">{nav.filter(item=>item.id!=='overview'&&item.id!=='users'&&item.id!=='imports').map(item=><button className="module" key={item.id} onClick={()=>setTab(item.id)}><div className="modicon"><item.icon/></div><div><small>GOOGLE SHEETS</small><h3>{item.label}</h3><p>Читання та запис до відповідного аркуша</p></div><b>↗</b></button>)}</div><section className="panel rules"><h3>Сховище та контроль доступу</h3><p>Cloudflare D1 вимкнений. Паролі в системі не створюються. Вхід виконується через Google OAuth, а дані читаються й записуються через Google Sheets API без проміжної бази.</p><p><b>Обмеження доступу:</b> Google надає права на всю книгу. Роль у аркуші Users обмежує елементи інтерфейсу, але не створює окремих серверних прав на рядки чи вкладки. Користувач із доступом до книги технічно може переглянути її вкладки через Google Drive/API. Не використовуйте цю конструкцію як межу ізоляції для персональних або клінічно чутливих даних.</p></section></>}
        {tab==='facilities'&&<><div className="section"><div><h2>Реєстр закладів охорони здоров’я</h2><p>Аркуш Facilities головної Google-книги</p></div><span className="pill">{facilities.length} закладів</span></div><div className="filter"><div><Search size={17}/><input value={facilityQuery} onChange={e=>setFacilityQuery(e.target.value)} placeholder="Пошук за назвою, ЄДРПОУ, районом або громадою"/></div><button className="btn" onClick={()=>void refreshAll()} disabled={loading}>Оновити</button></div><div className="metrics">{[['Заклади',facilities.length],['Громади',new Set(facilities.map(f=>f.hromada).filter(Boolean)).size],['Рівень допомоги',facilities.filter(f=>f.care_level).length],['Мережа',facilities.filter(f=>f.network_status).length]].map(x=><div className="metric" key={String(x[0])}><small>{x[0]}</small><b>{x[1]}</b><span>з Google Sheets</span></div>)}</div><section className="panel tablepanel"><div className="paneltitle"><div><h3>Заклади Тернопільської області</h3><p>Редагуйте довідник безпосередньо у Google Sheets</p></div><span>{selectedFacilities.length} записів</span></div><div className="tablewrap"><table><thead><tr>{['ЄДРПОУ','Назва закладу','Район','Громада','Населений пункт','Власність','Рівень допомоги','Спроможна мережа'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{selectedFacilities.map((f,i)=><tr key={f.edrpou||i}><td>{f.edrpou}</td><td><b>{f.name}</b></td><td>{f.district}</td><td>{f.hromada}</td><td>{f.settlement}</td><td>{f.ownership}</td><td>{f.care_level}</td><td>{f.network_status}</td></tr>)}</tbody></table>{!selectedFacilities.length&&<div className="empty">Аркуш Facilities не містить рядків або запит не повернув даних.</div>}</div></section></>}
        {(tab==='amr'||tab==='wgs')&&<><div className="section"><div><h2>{tab==='amr'?'Моніторинг антимікробної резистентності AST':'Геномний нагляд WGS'}</h2><p>Пряме читання та запис у {activeSheet}</p></div>{canWrite&&<button className="primary" onClick={()=>fileRef.current?.click()}><ArrowUpFromLine size={16}/> Завантажити Excel</button>}</div><div className="filter"><div><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук у поточному аркуші"/></div><button className="btn" onClick={exportAst}><ArrowDownToLine size={16}/> Експорт AST</button><button className="btn" onClick={downloadAstTemplate}>Шаблон AST</button>{canWrite&&<button className="btn" onClick={()=>addForm(activeSheet!)}><Plus size={16}/> Додати запис</button>}</div>{tab==='amr'&&<><div className="metrics">{[['Результати AST',astRows.length],['Мікроорганізми',new Set(astRows.map(r=>r.Bacterial_Species)).size],['Категорія R',astRows.filter(r=>r.SIR_Category.toUpperCase()==='R').length],['WGS',sheets.WGS_Staging?.rows.length??0]].map(x=><div className="metric" key={String(x[0])}><small>{x[0]}</small><b>{x[1]}</b><span>з Google Sheets</span></div>)}</div><section className="panel amr-map-panel"><div className="paneltitle"><div><h3>Територіальний розподіл результатів AMR</h3><p>Дані згруповані за територіальними громадами</p></div></div><AmrMap districtStats={districts} selectedDistrict={selectedDistrict} onSelectDistrict={name=>{setSelectedDistrict(name);setSelectedCommunity('all');}} communityStats={communities} selectedCommunity={selectedCommunity} onSelectCommunity={name=>{setSelectedCommunity(name);setSelectedDistrict('all');}}/><div className="amr-map-selection">{selectedCommunity!=='all'?'Обрана громада: '+selectedCommunity:selectedDistrict!=='all'?'Обраний район: '+selectedDistrict:'Територію не обрано'}</div></section></>}{showForm&&<form className="panel manual-panel" onSubmit={addGenericRecord}><div className="paneltitle"><div><h3>Новий запис у {activeSheet}</h3><p>Поля відповідають заголовкам активного аркуша</p></div></div><div className="manual-fields">{activeHeaders.map(header=><label key={header}>{header}<input value={draft[header]||''} onChange={e=>setDraft(current=>({...current,[header]:e.target.value}))}/></label>)}</div><button className="primary" type="submit" disabled={saving}>{saving?'Запис…':'Зберегти в Google Sheets'}</button></form>}<section className="panel tablepanel"><div className="paneltitle"><div><h3>Записи {activeSheet}</h3><p>Поточні дані з робочої книги</p></div><span>{visibleRows.length} рядків</span></div><div className="tablewrap"><table><thead><tr>{activeHeaders.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{visibleRows.map((row,i)=><tr key={i}>{activeHeaders.map(header=><td key={header}>{row[header]||'—'}</td>)}</tr>)}</tbody></table>{!visibleRows.length&&<div className="empty">Дані не знайдені.</div>}</div></section></>}
        {['visits','ipc','training','recommendations','legal'].includes(tab)&&activeSheet&&<><div className="section"><div><h2>{title}</h2><p>Робочий аркуш {activeSheet} у головній Google-книзі</p></div><span className="pill">{activeRecords.length} записів</span></div><div className="filter"><div><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук записів"/></div>{canWrite&&<button className="primary" onClick={()=>addForm(activeSheet)}><Plus size={16}/> Додати запис</button>}</div>{showForm&&<form className="panel manual-panel" onSubmit={addGenericRecord}><div className="paneltitle"><div><h3>Новий запис · {activeSheet}</h3><p>Значення буде додано безпосередньо в Google Sheets</p></div></div><div className="manual-fields">{activeHeaders.map(header=><label key={header}>{header}<input value={draft[header]||''} onChange={e=>setDraft(current=>({...current,[header]:e.target.value}))}/></label>)}</div><button className="primary" disabled={saving} type="submit">Зберегти запис</button></form>}<section className="panel tablepanel"><div className="tablewrap"><table><thead><tr>{activeHeaders.map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{visibleRows.map((row,i)=><tr key={i}>{activeHeaders.map(header=><td key={header}>{row[header]||'—'}</td>)}</tr>)}</tbody></table>{!visibleRows.length&&<div className="empty">У цьому аркуші поки немає записів.</div>}</div></section></>}
        {tab==='imports'&&<><div className="section"><div><h2>Імпорт та контроль якості даних</h2><p>Завантаження даних безпосередньо до Google Sheets</p></div></div><div className="modules">{(['AST_Data','WGS_Staging','IPC_Assessments','Training_Events','Legal_Acts'] as GoogleSheetTab[]).map(name=><button className="module" key={name} onClick={()=>{setTab(name==='AST_Data'?'amr':name==='WGS_Staging'?'wgs':name==='IPC_Assessments'?'ipc':name==='Training_Events'?'training':'legal');setShowForm(false);}}><div className="modicon"><FileSpreadsheet/></div><div><small>GOOGLE SHEETS</small><h3>{name}</h3><p>{sheets[name]?.rows.length??0} записів</p></div><b>↗</b></button>)}</div><section className="panel rules"><h3>Правила роботи з чутливими даними</h3><p>Не завантажуйте ПІБ, номери медичних карт або інші прямі ідентифікатори пацієнтів. Для Patient_ID використовуйте попередньо погоджений псевдонім. Google Sheets API записує дані безпосередньо в книгу; окремої серверної псевдонімізації більше немає.</p></section></>}
        {tab==='users'&&user.role==='admin'&&<><div className="section"><div><h2>Користувачі та доступ</h2><p>Профілі Google-акаунтів зберігаються на аркуші Users</p></div><span className="pill">{sheets.Users?.rows.length??0} профілів</span></div><section className="panel user-admin"><h3>Додати користувача</h3><form onSubmit={addUser}><div className="user-fields"><label>Email Google<input type="email" required value={draft.Email||''} onChange={e=>setDraft(d=>({...d,Email:e.target.value}))}/></label><label>ПІБ<input value={draft.Full_Name||''} onChange={e=>setDraft(d=>({...d,Full_Name:e.target.value}))}/></label><label>Роль<select value={draft.Role||'analyst'} onChange={e=>setDraft(d=>({...d,Role:e.target.value}))}><option value="operator">Оператор</option><option value="analyst">Аналітик</option><option value="admin">Адміністратор</option></select></label><label>Доступні коди закладів<input value={draft.Facility_Codes||''} onChange={e=>setDraft(d=>({...d,Facility_Codes:e.target.value}))} placeholder="Через кому або крапку з комою"/></label></div><div className="user-options"><label><input type="checkbox" checked={(draft.Is_Active||'TRUE')==='TRUE'} onChange={e=>setDraft(d=>({...d,Is_Active:e.target.checked?'TRUE':'FALSE'}))}/> Активний</label><label><input type="checkbox" checked={draft.All_Facilities==='TRUE'} onChange={e=>setDraft(d=>({...d,All_Facilities:e.target.checked?'TRUE':'FALSE'}))}/> Усі заклади</label></div><button className="primary" type="submit" disabled={saving}>Додати профіль</button></form></section><section className="panel tablepanel"><div className="tablewrap"><table><thead><tr>{USER_HEADERS.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{(sheets.Users?.rows||[]).map((row,i)=><tr key={i}>{USER_HEADERS.map(h=><td key={h}>{row[h]||'—'}</td>)}</tr>)}</tbody></table></div></section><section className="panel rules"><p>Для входу кожен працівник використовує свій Google-акаунт. Адміністратор додає його email до Users, а власник книги окремо надає цьому акаунту доступ у Google Drive. Роль у Users визначає інтерфейс застосунку, але не обмежує прямий доступ до всієї книги в Google Sheets.</p></section></>}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={event=>void importAst(event.target.files?.[0])}/>
        <footer>ДУ «Тернопільський обласний центр контролю та профілактики хвороб МОЗ України»<span>IPC & AMR Monitoring · Google Sheets</span></footer>
      </div>
    </main>
  </div>;
}
