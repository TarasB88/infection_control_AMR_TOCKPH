import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, ArrowDownToLine, BadgeCheck, Building2, CalendarDays, ClipboardCheck, Dna, FileSpreadsheet, FlaskConical, LayoutDashboard, Menu, Microscope, Search, ShieldCheck, Users, X, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { AmrMap } from './components/AmrMap';
import { COMMUNITY_SHAPES } from './lib/community-shapes';
import { DISTRICT_SHAPES } from './lib/map-shapes';
import {
  GOOGLE_SHEET_TABS, getSelectedSpreadsheet, readSheetTable, setSelectedSpreadsheet,
  type GoogleSheetTab, type SheetRecord,
} from './lib/google-sheets';

type Tab = 'overview'|'facilities'|'visits'|'ipc'|'training'|'amr'|'wgs'|'recommendations'|'imports'|'legal';
type SheetState = { headers:string[]; rows:SheetRecord[] };
type AstRow = { Hospital_ID:string; Hospital_Name:string; Region_Oblast:string; Territorial_Hromada:string; Settlement:string; Patient_ID:string; Sample_ID:string; Sampling_Date:string; Sample_Matrix_Type:string; Bacterial_Species:string; Antimicrobial_Agent:string; MIC_Operator:string; MIC_Value:string; Zone_Diameter:string; SIR_Category:string; Interpretation_Standard:string };
const AST_HEADERS = ['Hospital_ID','Hospital_Name','Region_Oblast','Territorial_Hromada','Settlement','Patient_ID','Sample_ID','Sampling_Date','Sample_Matrix_Type','Bacterial_Species','Antimicrobial_Agent','MIC_Operator','MIC_Value','Zone_Diameter','SIR_Category','Interpretation_Standard'];
const DEFAULT_HEADERS:Partial<Record<GoogleSheetTab,string[]>> = {
  Facilities:['EDRPOU','Name','Region_Oblast','District','Territorial_Hromada','Settlement','Address','Ownership','Care_Level','Network_Status','Monitoring_Years'],
  Facility_IPC_Profile:['Facility_ID','Facility_Name','Profile_Date','VIK_Unit','VIK_Staff_Count','VIK_FTE_Count','IPC_Program','Notes'],
  IPC_Assessments:['Assessment_ID','Facility_ID','Facility_Name','Visit_Date','Criterion_Code','Criterion_Name','Result','Score','Comment','Assessed_By','Created_At'],
  Legal_Acts:['Act_ID','Title','Document_Number','Document_Date','Source_URL','Status','Effective_From','Checked_At','Next_Review_Date','Responsible','Notes'],
  Training_Events:['Event_ID','Date','Title','Format','Organizer','Audience','Facilities','Participants','Hours','Assessed','Average_Score','Outcome','Notes','Created_By','Created_At'],
  Training_Facility_Stats:['Event_ID','Facility_ID','Facility_Name','Participants','Staff_Category','Notes'],
  AST_Data:AST_HEADERS,
  WGS_Staging:['WGS_ID','Hospital_ID','Hospital_Name','Sample_ID','Isolate_ID','Sequencing_Date','Sequencing_Platform','MLST_ST','Serotype_K_O_Antigen','AMR_Genotype_Genes','Point_Mutations','Virulence_Genes','Plasmid_Replicon_Type','FASTA_FASTQ_File_Link','Notes','Created_By','Created_At'],
  Dictionaries:['Dictionary','Code','Label','Parent_Code','Is_Active','Notes'],
};
const SHEET_BY_TAB:Partial<Record<Tab,GoogleSheetTab>> = {
  facilities:'Facilities', ipc:'IPC_Assessments', training:'Training_Events',
  amr:'AST_Data', wgs:'WGS_Staging', legal:'Legal_Acts',
};
const TAB_LABELS:Record<Tab,string> = {
  overview:'Огляд системи',facilities:'Реєстр закладів',visits:'Моніторингові візити',ipc:'Оцінювання IPC',
  training:'Навчальні заходи',amr:'Моніторинг AST',wgs:'Геномний нагляд WGS',recommendations:'Рекомендації',
  imports:'Внесення даних',legal:'Моніторинг НПА',
};
const REQUIRED_AST:(keyof AstRow)[] = AST_HEADERS.filter(field => !['Patient_ID','MIC_Operator','MIC_Value','Zone_Diameter'].includes(field)) as (keyof AstRow)[];
const norm=(value:string)=>value.toLocaleLowerCase('uk').replace(/[’'"_\s-]/g,'').replace(/[^a-zа-яіїєґ0-9]/gi,'');

const COLUMN_LABELS:Record<string,string> = {
  EDRPOU:'ЄДРПОУ',Name:'Назва закладу',Region_Oblast:'Область',District:'Район',
  Territorial_Hromada:'Територіальна громада',Settlement:'Населений пункт',Address:'Адреса',
  Ownership:'Форма власності',Care_Level:'Рівень медичної допомоги',Network_Status:'Статус спроможної мережі',
  Monitoring_Years:'Роки моніторингу',Facility_ID:'Код закладу',Facility_Name:'Назва закладу',
  Profile_Date:'Дата профілю',VIK_Unit:'Підрозділ ВІК',VIK_Staff_Count:'Кількість працівників ВІК',
  VIK_FTE_Count:'Штатні одиниці ВІК',IPC_Program:'Програма інфекційного контролю',
  Assessment_ID:'ID оцінювання',Visit_Date:'Дата візиту',Criterion_Code:'Код критерію',
  Criterion_Name:'Критерій оцінювання',Result:'Результат',Score:'Бал',Comment:'Коментар',
  Assessed_By:'Оцінив',Created_At:'Дата створення',Act_ID:'ID нормативного акта',Title:'Назва документа',
  Document_Number:'Номер документа',Document_Date:'Дата документа',Source_URL:'Посилання на джерело',
  Status:'Статус',Effective_From:'Чинний з',Checked_At:'Дата перевірки',
  Next_Review_Date:'Дата наступного перегляду',Responsible:'Відповідальний',
  Date:'Дата заходу',Format:'Формат',Organizer:'Організатор',Audience:'Цільова аудиторія',
  Facilities:'Заклади',Participants:'Кількість учасників',Hours:'Тривалість, год',
  Assessed:'Оцінювання проведено',Average_Score:'Середній бал',Outcome:'Підсумок',
  Created_By:'Створив запис',Staff_Category:'Категорія персоналу',Hospital_ID:'ID закладу',
  Hospital_Name:'Назва закладу',Patient_ID:'Псевдонімізований ID пацієнта',Sample_ID:'ID зразка',
  Sampling_Date:'Дата відбору',Sample_Matrix_Type:'Тип матеріалу',Bacterial_Species:'Вид мікроорганізму',
  Antimicrobial_Agent:'Антимікробний препарат',MIC_Operator:'Оператор MIC',MIC_Value:'Значення MIC',
  Zone_Diameter:'Діаметр зони затримки росту',SIR_Category:'Категорія чутливості (S/I/R)',
  Interpretation_Standard:'Стандарт інтерпретації',WGS_ID:'ID WGS',Isolate_ID:'ID ізоляту',
  Sequencing_Date:'Дата секвенування',Sequencing_Platform:'Платформа секвенування',
  MLST_ST:'MLST (ST)',Serotype_K_O_Antigen:'Серотип / K-O антиген',
  AMR_Genotype_Genes:'Гени резистентності AMR',Point_Mutations:'Точкові мутації',
  Virulence_Genes:'Гени вірулентності',Plasmid_Replicon_Type:'Тип плазмідного реплікону',
  FASTA_FASTQ_File_Link:'Посилання на FASTA/FASTQ',Dictionary:'Довідник',Code:'Код',
  Label:'Назва значення',Parent_Code:'Батьківський код',Is_Active:'Активний',Notes:'Примітки',
};
const COLUMN_LABELS_NORMALIZED=Object.fromEntries(Object.entries(COLUMN_LABELS).map(([key,label])=>[norm(key),label])) as Record<string,string>;
const columnLabel=(header:string)=>COLUMN_LABELS_NORMALIZED[norm(header)]||header.replace(/[_-]+/g,' ');
const getCell=(record:SheetRecord,names:string[],fallback='')=>{
  for(const name of names){
    const key=norm(name);
    const found=Object.entries(record).find(([header])=>norm(header)===key);
    if(found)return String(found[1]??'').trim();
  }
  return fallback;
};
const parseAst=(record:SheetRecord):AstRow=>Object.fromEntries(AST_HEADERS.map(key=>[key,getCell(record,[key])])) as unknown as AstRow;
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
  const [notice,setNotice]=useState('Завантаження даних із робочої Google-таблиці…');
  const [sheets,setSheets]=useState<Partial<Record<GoogleSheetTab,SheetState>>>({});
  const [loading,setLoading]=useState(false);
  const [query,setQuery]=useState('');
  const [facilityQuery,setFacilityQuery]=useState('');
  const [selectedDistrict,setSelectedDistrict]=useState('all');
  const [selectedCommunity,setSelectedCommunity]=useState('all');
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

  const refreshAll=async()=>{
    if(!getSelectedSpreadsheet().id){
      const workbookInput=window.prompt('Вставте посилання на публічну Google-таблицю IPC & AMR:');
      if(!workbookInput?.trim()) return;
      try{setSelectedSpreadsheet(workbookInput);}catch(error){setNotice(error instanceof Error?error.message:String(error));return;}
    }
    setLoading(true);
    try{
      const loaded:Partial<Record<GoogleSheetTab,SheetState>>={};
      for(const name of GOOGLE_SHEET_TABS){
        const table=await readSheetTable(name);
        loaded[name]=table;
      }
      setSheets(loaded);
      const total=Object.values(loaded).reduce((sum,table)=>sum+(table?.rows.length||0),0);
      setNotice('Оновлено '+GOOGLE_SHEET_TABS.length+' аркушів Google Sheets · '+total+' рядків даних.');
    }catch(error){setNotice('Не вдалося оновити Google Sheets: '+(error instanceof Error?error.message:String(error)));}
    finally{setLoading(false);}
  };

  useEffect(()=>{
    if(getSelectedSpreadsheet().id){
      void refreshAll();
    }else{
      setNotice('Щоб завантажити дані, один раз вкажіть посилання на публічну Google-таблицю кнопкою «Оновити дані». Надалі дані завантажуватимуться автоматично під час відкриття дашборду.');
    }
  },[]);

  const exportAst=()=>{
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.json_to_sheet(astRows),'AMR_AST');
    XLSX.writeFile(workbook,'AMR_AST_export.xlsx');
  };

  const downloadAstTemplate=()=>{
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet([AST_HEADERS]),'AST_Data');
    XLSX.writeFile(workbook,'AST_Data_template.xlsx');
  };

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
  ];
  const activeHeaders=activeSheet?sheets[activeSheet]?.headers||[]:[];
  const canWrite=Boolean(googleProfile);
  const addForm=(sheet:GoogleSheetTab)=>{setDraft(Object.fromEntries((sheets[sheet]?.headers||[]).map(h=>[h,''])));setShowForm(true);};
  const activeRecords=activeSheet?sheets[activeSheet]?.rows||[]:[];
  const selectedFacilities=activeSheet==='Facilities'?visibleFacilities:[];

  return <div className="shell">
    <aside className={'sidebar '+(mobile?'open':'')}>
      <div className="brand"><div className="brandmark"><ShieldCheck/></div><div><b>ТЕРНОПІЛЬСЬКИЙ ОЦКПХ</b><small>IPC & AMR MONITORING</small></div><button className="close" onClick={()=>setMobile(false)}><X/></button></div>
      <div className="sideintro">ІНФОРМАЦІЙНО-АНАЛІТИЧНА СИСТЕМА</div>
      {['РОБОЧА ПАНЕЛЬ','ІНФЕКЦІЙНИЙ КОНТРОЛЬ','ЛАБОРАТОРНИЙ НАГЛЯД','ІНСТРУМЕНТИ','НОРМАТИВНО-ПРАВОВА БАЗА'].map(group=><div className="navgroup" key={group}><label>{group}</label>{nav.filter(item=>item.group===group).map(item=><button key={item.id} className={'nav '+(tab===item.id?'active':'')} onClick={()=>{setTab(item.id);setMobile(false);setQuery('');}}><item.icon size={17}/>{item.label}</button>)}</div>)}
      <div className="sidebottom"><ShieldCheck size={16}/> Google Sheets · лише читання<small>Оновлення через Google Sheets</small></div>
    </aside>
    <main>
      <header className="topbar"><button className="hamb" onClick={()=>setMobile(true)}><Menu/></button><div>IPC & AMR <span>/</span> {title}</div><div className="topright"><button className="primary" onClick={()=>void refreshAll()} disabled={loading}><RefreshCw size={16}/>{loading?'Оновлення…':'Оновити дані'}</button></div></header>
      <div className="page">
        <div className="pagehead"><div><label>ТЕРНОПІЛЬСЬКИЙ ОБЛАСНИЙ ЦЕНТР КОНТРОЛЮ ТА ПРОФІЛАКТИКИ ХВОРОБ МОЗ УКРАЇНИ</label><h1>{tab==='overview'?'Моніторинг інфекційного контролю та AMR':title}</h1><p>{tab==='overview'?'Єдиний робочий простір. Дані завантажуються з публічної робочої Google-книги.':'Джерело даних: головна Google-книга IPC & AMR.'}</p></div></div>
        <div className="notice"><AlertCircle size={17}/>{notice}</div>
        {tab==='overview'&&<><div className="section"><div><h2>Робочий огляд</h2><p>Кількість записів безпосередньо в Google Sheets</p></div><span className="pill">GOOGLE SHEETS · READ ONLY</span></div><div className="metrics">{GOOGLE_SHEET_TABS.map(name=><div className="metric" key={name}><small>{name}</small><b>{sheets[name]?.rows.length??0}</b><span>рядків даних</span></div>)}</div><div className="modules">{nav.filter(item=>item.id!=='overview'&&item.id!=='imports').map(item=><button className="module" key={item.id} onClick={()=>setTab(item.id)}><div className="modicon"><item.icon/></div><div><small>GOOGLE SHEETS</small><h3>{item.label}</h3><p>Перегляд даних відповідного аркуша</p></div><b>↗</b></button>)}</div><section className="panel rules"><h3>Сховище та контроль доступу</h3><p>Дашборд отримує дані в режимі читання з публічної Google-книги. Нові записи вносяться через Google Forms, прив’язані до цієї книги.</p><p><b>Обмеження доступу:</b> Google надає права на всю книгу. Доступ визначається правами Google Drive на всю книгу. Кожен, кому надано доступ редактора до книги, може переглядати та змінювати всі її вкладки. Не використовуйте цю конструкцію як межу ізоляції для персональних або клінічно чутливих даних.</p></section></>}
        {tab==='facilities'&&<><div className="section"><div><h2>Реєстр закладів охорони здоров’я</h2><p>Аркуш Facilities головної Google-книги</p></div><span className="pill">{facilities.length} закладів</span></div><div className="filter"><div><Search size={17}/><input value={facilityQuery} onChange={e=>setFacilityQuery(e.target.value)} placeholder="Пошук за назвою, ЄДРПОУ, районом або громадою"/></div><button className="btn" onClick={()=>void refreshAll()} disabled={loading}>Оновити</button></div><div className="metrics">{[['Заклади',facilities.length],['Громади',new Set(facilities.map(f=>f.hromada).filter(Boolean)).size],['Рівень допомоги',facilities.filter(f=>f.care_level).length],['Мережа',facilities.filter(f=>f.network_status).length]].map(x=><div className="metric" key={String(x[0])}><small>{x[0]}</small><b>{x[1]}</b><span>з Google Sheets</span></div>)}</div><section className="panel tablepanel"><div className="paneltitle"><div><h3>Заклади Тернопільської області</h3><p>Довідник закладів із робочої Google-книги</p></div><span>{selectedFacilities.length} записів</span></div><div className="tablewrap"><table><thead><tr>{['ЄДРПОУ','Назва закладу','Район','Громада','Населений пункт','Власність','Рівень допомоги','Спроможна мережа'].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{selectedFacilities.map((f,i)=><tr key={f.edrpou||i}><td>{f.edrpou}</td><td><b>{f.name}</b></td><td>{f.district}</td><td>{f.hromada}</td><td>{f.settlement}</td><td>{f.ownership}</td><td>{f.care_level}</td><td>{f.network_status}</td></tr>)}</tbody></table>{!selectedFacilities.length&&<div className="empty">Аркуш Facilities не містить рядків або запит не повернув даних.</div>}</div></section></>}
        {(tab==='amr'||tab==='wgs')&&<><div className="section"><div><h2>{tab==='amr'?'Моніторинг антимікробної резистентності AST':'Геномний нагляд WGS'}</h2><p>Дані з аркуша {activeSheet}</p></div></div><div className="filter"><div><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук у поточному аркуші"/></div><button className="btn" onClick={exportAst}><ArrowDownToLine size={16}/> Експорт AST</button><button className="btn" onClick={downloadAstTemplate}>Шаблон AST</button></div>{tab==='amr'&&<><div className="metrics">{[['Результати AST',astRows.length],['Мікроорганізми',new Set(astRows.map(r=>r.Bacterial_Species)).size],['Категорія R',astRows.filter(r=>r.SIR_Category.toUpperCase()==='R').length],['WGS',sheets.WGS_Staging?.rows.length??0]].map(x=><div className="metric" key={String(x[0])}><small>{x[0]}</small><b>{x[1]}</b><span>з Google Sheets</span></div>)}</div><section className="panel amr-map-panel"><div className="paneltitle"><div><h3>Територіальний розподіл результатів AMR</h3><p>Дані згруповані за територіальними громадами</p></div></div><AmrMap districtStats={districts} selectedDistrict={selectedDistrict} onSelectDistrict={name=>{setSelectedDistrict(name);setSelectedCommunity('all');}} communityStats={communities} selectedCommunity={selectedCommunity} onSelectCommunity={name=>{setSelectedCommunity(name);setSelectedDistrict('all');}}/><div className="amr-map-selection">{selectedCommunity!=='all'?'Обрана громада: '+selectedCommunity:selectedDistrict!=='all'?'Обраний район: '+selectedDistrict:'Територію не обрано'}</div></section></>}<section className="panel tablepanel"><div className="paneltitle"><div><h3>Записи {activeSheet}</h3><p>Поточні дані з робочої книги</p></div><span>{visibleRows.length} рядків</span></div><div className="tablewrap"><table><thead><tr>{activeHeaders.map(header=><th key={header}>{columnLabel(header)}</th>)}</tr></thead><tbody>{visibleRows.map((row,i)=><tr key={i}>{activeHeaders.map(header=><td key={header}>{row[header]||'—'}</td>)}</tr>)}</tbody></table>{!visibleRows.length&&<div className="empty">Дані не знайдені.</div>}</div></section></>}
        {['visits','ipc','training','recommendations','legal'].includes(tab)&&activeSheet&&<><div className="section"><div><h2>{title}</h2><p>Робочий аркуш {activeSheet} у головній Google-книзі</p></div><span className="pill">{activeRecords.length} записів</span></div><div className="filter"><div><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук записів"/></div></div><section className="panel tablepanel"><div className="tablewrap"><table><thead><tr>{activeHeaders.map(header=><th key={header}>{columnLabel(header)}</th>)}</tr></thead><tbody>{visibleRows.map((row,i)=><tr key={i}>{activeHeaders.map(header=><td key={header}>{row[header]||'—'}</td>)}</tr>)}</tbody></table>{!visibleRows.length&&<div className="empty">У цьому аркуші поки немає записів.</div>}</div></section></>}
        {tab==='imports'&&<><div className="section"><div><h2>Внесення та контроль якості даних</h2><p>Перегляд і контроль даних; внесення — через Google Forms</p></div></div><div className="modules">{(['AST_Data','WGS_Staging','IPC_Assessments','Training_Events','Legal_Acts'] as GoogleSheetTab[]).map(name=><button className="module" key={name} onClick={()=>{setTab(name==='AST_Data'?'amr':name==='WGS_Staging'?'wgs':name==='IPC_Assessments'?'ipc':name==='Training_Events'?'training':'legal');setShowForm(false);}}><div className="modicon"><FileSpreadsheet/></div><div><small>GOOGLE SHEETS</small><h3>{name}</h3><p>{sheets[name]?.rows.length??0} записів</p></div><b>↗</b></button>)}</div><section className="panel rules"><h3>Правила роботи з чутливими даними</h3><p>Не завантажуйте ПІБ, номери медичних карт або інші прямі ідентифікатори пацієнтів. Для Patient_ID використовуйте попередньо погоджений псевдонім. Дашборд працює в режимі читання; внесення даних здійснюється через Google Forms, прив'язані до цієї книги.</p></section></>}
        
        <footer>ДУ «Тернопільський обласний центр контролю та профілактики хвороб МОЗ України»<span>IPC & AMR Monitoring · Google Sheets</span></footer>
      </div>
    </main>
  </div>;
}
