'use strict';

// Périodes des récompenses, en heure de Paris : jour de minuit à minuit,
// semaine du lundi minuit au lundi suivant, mois du 1er à minuit au 1er du mois suivant.

function parisDateParts(date=new Date()){
  const parts=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));
  const out={};for(const p of parts)if(p.type!=='literal')out[p.type]=p.value;
  return{year:Number(out.year),month:Number(out.month),day:Number(out.day)};
}
function parisDayKey(date=new Date()){
  const p=parisDateParts(date);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
function parisWeekKey(date=new Date()){
  const p=parisDateParts(date),d=new Date(Date.UTC(p.year,p.month-1,p.day)),day=d.getUTCDay(),diff=day===0?-6:1-day;
  d.setUTCDate(d.getUTCDate()+diff);
  return d.toISOString().slice(0,10);
}
function parisOffsetMinutes(date=new Date()){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'longOffset',hour:'2-digit'}).formatToParts(new Date(date));
  const raw=parts.find(p=>p.type==='timeZoneName')?.value||'GMT+01:00';
  const m=raw.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if(!m)return 60;
  const minutes=Number(m[2])*60+Number(m[3]||0);
  return m[1]==='-'?-minutes:minutes;
}
function parisLocalMidnight(key){
  const [year,month,day]=key.split('-').map(Number);
  // Offset read just before local midnight (22:00 UTC the previous day), not
  // at noon: on daylight-saving days the noon offset differs from midnight's.
  const probe=new Date(Date.UTC(year,month-1,day,0,0,0)-2*3600_000);
  return new Date(Date.UTC(year,month-1,day,0,0,0)-parisOffsetMinutes(probe)*60000);
}
function parisMonthKey(date=new Date()){
  const p=parisDateParts(date);
  return `${p.year}-${String(p.month).padStart(2,'0')}-01`;
}
function periodInfo(kind,date=new Date()){
  const key=kind==='weekly'?parisWeekKey(date):kind==='monthly'?parisMonthKey(date):parisDayKey(date);
  const start=parisLocalMidnight(key);
  // Advance from the calendar period key, not the UTC date of local midnight.
  // In Europe/Paris, local midnight falls on the previous UTC date; using
  // start.getUTCDate() here made daily periods end at their own start.
  const [year,month,day]=key.split('-').map(Number);
  const days=kind==='weekly'?7:1;
  // Mois : du 1er à minuit au 1er du mois suivant à minuit (heure de Paris).
  const nextDate=kind==='monthly'?new Date(Date.UTC(year,month,1,12,0,0)):new Date(Date.UTC(year,month-1,day+days,12,0,0));
  const nextKey=nextDate.toISOString().slice(0,10);
  const end=parisLocalMidnight(nextKey);
  return{key,start,end};
}
function taskClaimId(kind,periodKey,taskId){return `${kind}:${periodKey}:${taskId}`;}

module.exports = { parisDateParts, parisDayKey, parisWeekKey, parisMonthKey, parisOffsetMinutes, parisLocalMidnight, periodInfo, taskClaimId };
