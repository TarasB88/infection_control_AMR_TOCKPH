import { useMemo, useState, type FormEvent } from 'react';
import { GraduationCap, Plus, Search, Users, Building2, CalendarDays, Trash2 } from 'lucide-react';

type TrainingEvent = {
  id: string; date: string; title: string; format: string; organizer: string;
  audience: string; facilities: string; participants: number; hours: number;
  assessed: number; averageScore: string; outcome: string; notes: string;
};

const initialForm = {
  date: new Date().toISOString().slice(0,10), title: '', format: 'Офлайн',
  organizer: 'Тернопільський ОЦКПХ', audience: 'Керівники та фахівці з інфекційного контролю',
  facilities: '', participants: '0', hours: '1', assessed: '0', averageScore: '',
  outcome: '', notes: ''
};

export function Training(){
  const [events,setEvents]=useState<TrainingEvent[]>([]);
  const [form,setForm]=useState(initialForm);
  const [showForm,setShowForm]=useState(false);
  const [query,setQuery]=useState('');
  const [year,setYear]=useState('all');
  const [format,setFormat]=useState('all');
  const [error,setError]=useState('');

  const filtered=useMemo(()=>events.filter(e=>
    (year==='all'||e.date.slice(0,4)===year)&&
    (format==='all'||e.format===format)&&
    [e.title,e.organizer,e.audience,e.facilities,e.outcome].join(' ').toLocaleLowerCase('uk').includes(query.toLocaleLowerCase('uk'))
  ).sort((a,b)=>b.date.localeCompare(a.date)),[events,year,format,query]);

  const totalParticipants=filtered.reduce((sum,e)=>sum+e.participants,0);
  const totalFacilities=new Set(filtered.flatMap(e=>e.facilities.split(/[;,\n]/).map(v=>v.trim()).filter(Boolean))).size;
  const submit=(event:FormEvent)=>{
    event.preventDefault();
    if(!form.date||!form.title.trim()||!form.audience.trim()||Number(form.participants)<1){setError('Заповніть дату, тему, цільову аудиторію та вкажіть кількість учасників більше нуля.');return;}
    const item:TrainingEvent={...form,id:globalThis.crypto?.randomUUID?.()??String(Date.now()),participants:Number(form.participants),hours:Number(form.hours)||0,assessed:Number(form.assessed)||0};
    setEvents(prev=>[item,...prev]);setForm(initialForm);setError('');setShowForm(false);
  };

  return <><div className="section"><div><h2>Облік навчальних заходів</h2><p>Реєстр навчань, тренінгів, семінарів та оцінювання знань з IPC і AMR</p></div><button className="primary" onClick={()=>setShowForm(v=>!v)}><Plus size={16}/>{showForm?'Закрити форму':'Додати захід'}</button></div>
    <div className="training-metrics">
      <div className="metric"><small>Проведено заходів</small><b>{filtered.length}</b><span>у поточній вибірці</span></div>
      <div className="metric"><small>Учасники</small><b>{totalParticipants}</b><span>сума учасників заходів</span></div>
      <div className="metric"><small>Заклади охоплення</small><b>{totalFacilities}</b><span>унікальні назви з реєстру</span></div>
      <div className="metric"><small>Оцінювання знань</small><b>{filtered.reduce((s,e)=>s+e.assessed,0)}</b><span>учасників оцінено</span></div>
    </div>
    {showForm&&<form className="panel training-form" onSubmit={submit}>
      <div className="paneltitle"><div><h3>Реєстрація навчального заходу</h3><p>Внесіть фактичні дані проведеного заходу</p></div></div>
      <div className="training-fields">
        <label>Дата проведення *<input type="date" value={form.date} onChange={e=>setForm({...form,date:e.target.value})}/></label>
        <label className="wide">Тема заходу *<input value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Наприклад: Практичні аспекти інфекційного контролю"/></label>
        <label>Формат<select value={form.format} onChange={e=>setForm({...form,format:e.target.value})}>{['Офлайн','Онлайн','Змішаний'].map(v=><option key={v}>{v}</option>)}</select></label>
        <label>Організатор<input value={form.organizer} onChange={e=>setForm({...form,organizer:e.target.value})}/></label>
        <label className="wide">Цільова аудиторія *<input value={form.audience} onChange={e=>setForm({...form,audience:e.target.value})} placeholder="Посади / категорії працівників"/></label>
        <label className="wide">Заклади-учасники<input value={form.facilities} onChange={e=>setForm({...form,facilities:e.target.value})} placeholder="Назви закладів через кому або крапку з комою"/></label>
        <label>Кількість учасників *<input type="number" min="1" value={form.participants} onChange={e=>setForm({...form,participants:e.target.value})}/></label>
        <label>Тривалість, годин<input type="number" min="0" step="0.5" value={form.hours} onChange={e=>setForm({...form,hours:e.target.value})}/></label>
        <label>Оцінено знання, осіб<input type="number" min="0" value={form.assessed} onChange={e=>setForm({...form,assessed:e.target.value})}/></label>
        <label>Середній бал / результат<input value={form.averageScore} onChange={e=>setForm({...form,averageScore:e.target.value})} placeholder="За наявності"/></label>
        <label className="wide">Результати / ключові висновки<textarea rows={2} value={form.outcome} onChange={e=>setForm({...form,outcome:e.target.value})} placeholder="Коротко про результати навчання"/></label>
        <label className="wide">Примітки<input value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></label>
      </div>
      {error&&<p className="training-error">{error}</p>}
      <div className="training-actions"><button type="button" className="btn" onClick={()=>{setShowForm(false);setError('');}}>Скасувати</button><button type="submit" className="primary">Зберегти захід</button></div>
    </form>}
    <section className="panel training-list">
      <div className="paneltitle"><div><h3>Реєстр проведених заходів</h3><p>Фільтрація за роком, форматом та змістом заходу</p></div><span>{filtered.length} заходів</span></div>
      <div className="training-filter"><div className="training-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Пошук за темою, організатором, аудиторією або ЗОЗ"/></div><select value={year} onChange={e=>setYear(e.target.value)}><option value="all">Усі роки</option>{Array.from(new Set(events.map(e=>e.date.slice(0,4)))).sort().reverse().map(v=><option key={v}>{v}</option>)}</select><select value={format} onChange={e=>setFormat(e.target.value)}><option value="all">Усі формати</option>{['Офлайн','Онлайн','Змішаний'].map(v=><option key={v}>{v}</option>)}</select></div>
      {filtered.length===0?<div className="training-empty"><GraduationCap/><b>Записів поки немає</b><span>Додайте перший проведений навчальний захід. Показники не заповнюються демонстраційними значеннями.</span></div>:
      <div className="tablewrap"><table><thead><tr>{['Дата','Тема заходу','Формат','Цільова аудиторія','Заклади','Учасники','Тривалість','Оцінено','Результат',''].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{filtered.map(e=><tr key={e.id}><td className="mono">{e.date}</td><td><b>{e.title}</b><small className="training-sub">{e.organizer}</small></td><td>{e.format}</td><td>{e.audience}</td><td>{e.facilities||'—'}</td><td>{e.participants}</td><td>{e.hours} год.</td><td>{e.assessed||'—'}</td><td>{e.averageScore||e.outcome||'—'}</td><td><button className="training-delete" title="Видалити запис" onClick={()=>setEvents(prev=>prev.filter(x=>x.id!==e.id))}><Trash2 size={15}/></button></td></tr>)}</tbody></table></div>}
    </section>
    <section className="training-info"><Users/><span><b>Методологічна примітка</b>Показники відображають суму учасників за заходами, а не кількість унікальних осіб. Якщо працівник відвідав кілька навчань, він враховується в кожному заході. Реєстр у цій версії зберігається лише в стані поточного сеансу браузера; постійне збереження та спільний доступ потребують підключення бази даних.</span></section>
  </>;
}
