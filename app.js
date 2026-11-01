'use strict';
const $=id=>document.getElementById(id),show=(id,yes=true)=>$(id).hidden=!yes;
const state={token:'',operator:'',trip:null,port:'',snapshot:null,view:'scan',busy:false,camera:null,cameraOn:false,scanHold:false,undo:null,closeId:'',refreshing:false,revision:0,lastCode:'',lastAt:0,uncertain:new Set()};
const labels={VALIDO:'IMBARCO REGISTRATO',GIA_USATO:'GIÀ IMBARCATO IN QUESTO PORTO',ANNULLATO:'BIGLIETTO ANNULLATO',ALTRA_DATA:'BIGLIETTO DI ALTRA DATA',ALTRA_CORSA:'BIGLIETTO DI ALTRA CORSA',NON_TROVATO:'BIGLIETTO NON TROVATO',PORTO_NON_PREVISTO:'PORTO NON PREVISTO O AMBIGUO',DUPLICATO_ARCHIVIO:'CODICE DUPLICATO IN ARCHIVIO',DATI_NON_VALIDI:'DATI BIGLIETTO DA VERIFICARE',NON_IMBARCATO:'CHECK-IN NON PRESENTE',CHECKIN_ANNULLATO:'CHECK-IN ANNULLATO'};
let noticeTimer,audio,boardingResumeAt=0;
function notify(message){$('notice').textContent=message;show('notice');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>show('notice',false),7000);}
function dateLabel(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):v;}
function context(){return {date:state.trip?.date,corsa:state.trip?.corsa,port:state.port};}
// Server status uses actual API responses; no additional requests or write retries.
let serverSequence=0,serverLastReply=0,serverMode='unknown';
function serverStatus(mode,message){
  serverMode=mode;const badge=$('environment');if(!badge)return;
  badge.hidden=false;badge.dataset.status=mode;badge.textContent='● '+message;
  badge.title=serverLastReply?'Ultima risposta: '+new Date(serverLastReply).toLocaleTimeString('it-IT'):'Nessuna risposta ricevuta in questa sessione';
}
function serverFreshness(){
  if(navigator.onLine===false){serverStatus('offline','Connessione assente');return;}
  if(serverMode==='online'&&Date.now()-serverLastReply>45000)serverStatus('unknown','Server: da verificare');
}
async function api(action,params={}){
  const url=window.JBM_CONFIG?.apiUrl||'';
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url))throw Error('Backend di test non configurato. Impostare config.js dopo aver creato il nuovo progetto Apps Script.');
  const request=++serverSequence;let replied=false;
  if(!serverLastReply)serverStatus('pending','Server: connessione…');
  const slow=setTimeout(()=>{if(request===serverSequence)serverStatus('pending','Server: risposta lenta');},8000);
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token:state.token,...context(),...params}),redirect:'follow',signal:controller.signal,credentials:'omit'});
    if(!response.ok)throw Error('Risposta HTTP '+response.status);
    const d=await response.json();
    if(!d||typeof d.esito!=='string')throw Error('Risposta del server non valida.');
    replied=true;
    if(request===serverSequence){serverLastReply=Date.now();serverStatus(d.esito==='ERRORE'?'error':d.esito==='OCCUPATO'||d.esito==='ATTENDI'?'pending':'online',d.esito==='ERRORE'?'Server: errore':d.esito==='OCCUPATO'||d.esito==='ATTENDI'?'Server: occupato':'Server: online');}
    if(d.esito==='SESSIONE_SCADUTA'){await reset();throw Error('Sessione scaduta. Accedi nuovamente.');}
    if(['ERRORE','OCCUPATO','ATTENDI','ACCESSO_NEGATO'].includes(d.esito))throw Error(d.message||d.esito);
    return d;
  }catch(e){if(!replied&&request===serverSequence)serverStatus('offline',navigator.onLine===false?'Connessione assente':'Server: non raggiungibile');if(e.name==='AbortError'||e instanceof TypeError)throw Error('Risposta non ricevuta. L’operazione potrebbe essere stata registrata: aggiorna i dati prima di riprovare.');throw e;}
  finally{clearTimeout(timeout);clearTimeout(slow);}
}
async function guarded(fn){if(state.busy){notify('Attendi il completamento dell’operazione in corso.');return;}state.busy=true;try{await fn();}catch(e){notify(e?.message||String(e));}finally{state.busy=false;}}
function sound(kind){try{if($('soundEnabled').checked){audio=audio||new(window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);const now=audio.currentTime;g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(.25,now+.015);g.gain.setValueAtTime(.25,now+.22);g.gain.linearRampToValueAtTime(0,now+.30);o.frequency.value=kind==='VALIDO'?1100:kind==='GIA_USATO'?650:250;o.start(now);o.stop(now+.31);}if($('vibrationEnabled').checked&&navigator.vibrate)navigator.vibrate(kind==='VALIDO'?60:[80,60,80]);}catch(e){}}
// Short acquisition beep, distinct from the later server outcome signal.
function readSound(){
 if(!$('soundEnabled').checked)return;
 try{
  audio=audio||new(window.AudioContext||window.webkitAudioContext)();
  audio.resume();
  const o=audio.createOscillator(),g=audio.createGain(),now=audio.currentTime;
  o.connect(g);g.connect(audio.destination);o.frequency.value=1600;
  g.gain.setValueAtTime(0,now);g.gain.linearRampToValueAtTime(.20,now+.005);
  g.gain.exponentialRampToValueAtTime(.001,now+.075);
  o.onended=()=>{o.disconnect();g.disconnect();};o.start(now);o.stop(now+.08);
 }catch(e){}
}
function dismiss(){for(const id of ['menuDialog','panelDialog'])if($(id).open)$(id).close();state.view='scan';$('menuButton').setAttribute('aria-expanded','false');}
function result(kind,title,details=''){show('result');$('result').className=kind;$('result').replaceChildren(el('strong',title),el('span',details));}
function el(tag,text,className){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(className)e.className=className;return e;}
async function reset(){dismiss();state.revision++;await stopCamera();show('menuButton',false);Object.assign(state,{token:'',operator:'',trip:null,port:'',snapshot:null,undo:null,closeId:''});show('workspace',false);show('login');show('operation',false);show('setup');show('history',false);$('password').value='';$('passengers').replaceChildren();$('historyContent').replaceChildren();show('result',false);}
$('loginForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{const d=await api('login',{operator:$('operator').value.trim(),password:$('password').value});state.token=d.token;state.operator=d.operator;$('password').value='';$('welcome').textContent=state.operator;show('login',false);show('workspace');show('menuButton');await loadTrips();});};
async function loadTrips(){const d=await api('corse');$('trip').replaceChildren(new Option('Seleziona corsa',''));d.corse.forEach(t=>$('trip').add(new Option(dateLabel(t.date)+' · '+t.corsa,JSON.stringify(t))));$('port').replaceChildren(new Option('Seleziona prima la corsa',''));}
$('trip').onchange=()=>guarded(async()=>{state.revision++;state.trip=$('trip').value?JSON.parse($('trip').value):null;state.port='';$('port').replaceChildren(new Option('Seleziona porto',''));if(!state.trip)return;const d=await api('porti');d.porti.forEach(p=>$('port').add(new Option(p,p)));});
$('start').onclick=()=>guarded(async()=>{if(!$('trip').value||!$('port').value)throw Error('Seleziona corsa e porto.');state.revision++;state.trip=JSON.parse($('trip').value);state.port=$('port').value;state.closeId=crypto.randomUUID();result('','PRONTO ALLA LETTURA','Inquadra un biglietto.');$('tripDate').textContent=dateLabel(state.trip.date)+' · '+state.trip.nave;$('tripTitle').textContent=state.trip.corsa;$('portTitle').textContent='Porto di imbarco: '+state.port;await refresh();show('setup',false);show('operation');await view('scan');});
$('logout').onclick=()=>guarded(async()=>{try{await api('logout');}finally{await reset();}});
async function changeContext(onlyPort=false){dismiss();state.revision++;await stopCamera();state.snapshot=null;show('operation',false);show('setup');if(onlyPort){state.port='';$('port').focus();}else{state.trip=null;state.port='';await loadTrips();}}
async function view(name){
  dismiss();state.view=name;if(name==='scan')return;
  const titles={manual:'Inserimento manuale',list:'Passeggeri',report:'Riepilogo e statistiche',history:'Storico ultime 50 corse',undo:'Sbarco',lookup:'Ricerca biglietto',settings:'Impostazioni'};
  document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==name);$('panelTitle').textContent=titles[name]||name;$('panelDialog').showModal();
  if(name==='history')await history();
  if(name==='list'){await refresh(true);renderList();}
  if(name==='report'){await refresh();renderReport();}
  if(name==='manual')$('code').focus();
  if(name==='settings')$('operatorInfo').textContent='Operatore: '+state.operator;
  if(name==='undo'){state.undo=null;show('undoConfirm',false);$('undoDetails').replaceChildren();}
}
$('menuButton').onclick=()=>{$('menuDialog').showModal();$('menuButton').setAttribute('aria-expanded','true');};
document.querySelectorAll('[data-dismiss]').forEach(b=>b.onclick=dismiss);
for(const id of ['menuDialog','panelDialog'])$(id).addEventListener('close',()=>{if(!$('menuDialog').open&&!$('panelDialog').open)state.view='scan';});
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>guarded(async()=>{
 const a=b.dataset.action;
 if(['operator','cameraSettings','sound'].includes(a))return view('settings');
 if(a==='history')return view('history');
 if(a==='trip')return changeContext();
 if(!state.port)throw Error('Apri prima una corsa e seleziona il porto.');
 if(a==='port')return changeContext(true);
 if(['imbarcati','mancanti','details'].includes(a)){$('listState').value=a==='details'?'all':a;return view('list');}
 await view(a);
}));
$('manualButton').onclick=()=>guarded(()=>view('manual'));
$('sbarcoButton').onclick=()=>guarded(()=>view('undo'));
$('operatorChange').onclick=()=>{if(confirm('Terminare la sessione per cambiare operatore?'))$('logout').click();};
$('resumeCamera').onclick=()=>guarded(async()=>{if(!state.port)throw Error('Apri prima una corsa.');dismiss();if(!state.cameraOn)await startCamera();});
let refreshTask=null,refreshSequence=0;
function applySnapshot(snapshot){state.snapshot=snapshot;renderStats();if(state.view==='list')renderList();if(state.view==='report')renderReport();$('freshness').textContent='Aggiornato '+new Date().toLocaleTimeString('it-IT')+(snapshot.invalidi?' · '+snapshot.invalidi+' dati da verificare':'');}
async function refresh(full=false){
 if(!state.trip||!state.port)return;
 if(refreshTask){await refreshTask;if(!full)return;}
 const selected=JSON.stringify(context()),revision=state.revision,seq=++refreshSequence;
 const task=(async()=>{try{const d=await api('snapshot',{lite:!full});if(selected!==JSON.stringify(context())||revision!==state.revision||!state.token||seq!==refreshSequence)return;applySnapshot(d.snapshot);}catch(e){if(revision===state.revision)$('freshness').textContent='Dati non aggiornati · '+e.message;throw e;}})();
 refreshTask=task;try{await task;}finally{if(refreshTask===task)refreshTask=null;}
}
setInterval(()=>{if(state.token&&state.port&&!state.busy&&!document.hidden&&!$('panelDialog').open)refresh().catch(()=>{});},15000);
function renderStats(){$('stats').replaceChildren();for(const [k,label] of Object.entries({totale:'Prenotati',imbarcati:'Imbarcati',mancanti:'Mancanti',annullati:'Annullati'})){const b=el('button',null,'stat');b.append(el('strong',state.snapshot[k]),el('span',label));b.onclick=()=>guarded(async()=>{$('listState').value=k==='totale'?'all':k;await view(k==='totale'?'report':'list');});$('stats').append(b);}}
function renderList(){if(!state.snapshot)return;const q=$('search').value.trim().toLowerCase(),filter=$('listState').value;const rows=(state.snapshot.lista||[]).filter(r=>(filter==='all'||r.state===filter)&&[r.id,r.nome,r.cognome].join(' ').toLowerCase().includes(q));$('passengers').replaceChildren();rows.forEach(r=>{const card=el('div',null,'passenger'),left=el('div');left.append(el('strong',r.nome+' '+r.cognome),el('p','Ticket '+r.id+' · '+r.pax+' pax'));left.append(el('p','Adulti '+r.counts[0]+' · Bambini '+r.counts[1]+' · Infant '+r.counts[2]),el('p',(r.port||state.port)+(r.time?' · '+new Date(r.time).toLocaleString('it-IT'):'')+(r.operator?' · '+r.operator:'')));if(r.telefono){const phone=el('a',r.telefono);phone.href='tel:'+r.telefono.replace(/[^+0-9]/g,'');left.append(phone);}card.append(left,el('span',r.state,'state'));$('passengers').append(card);});if(!rows.length)$('passengers').append(el('p','Nessun passeggero trovato.'));}
$('search').oninput=renderList;$('listState').onchange=renderList;
function reportTable(stats){const table=el('table'),head=el('tr');['Stato','Adulti','Bambini','Infant','Totale'].forEach(s=>head.append(el('th',s)));table.append(head);for(const k of ['totale','imbarcati','mancanti','annullati']){const tr=el('tr');[{totale:'Prenotati',imbarcati:'Imbarcati',mancanti:'Mancanti',annullati:'Annullati'}[k],...stats.counts[k],stats[k]].forEach(s=>tr.append(el('td',s)));table.append(tr);}return table;}
function reportMetrics(stats){
 const grid=el('div',null,'report-metrics');
 for(const [key,label] of Object.entries({totale:'Prenotati',imbarcati:'Imbarcati',mancanti:'Mancanti',annullati:'Annullati'})){
  const card=el('div',null,'report-metric metric-'+key);
  card.append(el('span',label),el('strong',stats[key]??0));grid.append(card);
 }
 return grid;
}
function reportHeading(date,corsa,port){
 const head=el('div',null,'report-heading');
 head.append(el('span',dateLabel(date),'report-date'),el('h3',corsa),el('p','Porto · '+port));return head;
}
function renderReport(){
 if(!state.snapshot)return;
 const root=$('reportContent');root.replaceChildren(reportHeading(state.trip.date,state.trip.corsa,state.port),reportMetrics(state.snapshot));
 const breakdown=el('section',null,'report-section');breakdown.append(el('h3','Composizione passeggeri'),reportTable(state.snapshot));root.append(breakdown);
 const operators=el('section',null,'report-section');operators.append(el('h3','Imbarcati per operatore'));
 const entries=Object.entries(state.snapshot.operatori||{});
 for(const [op,pax] of entries){const row=el('div',null,'operator-row');row.append(el('span',op),el('strong',pax+' pax'));operators.append(row);}
 if(!entries.length)operators.append(el('p','Nessun imbarco registrato.','report-muted'));
 root.append(operators,el('p','Riepilogo del porto selezionato · '+$('freshness').textContent,'report-muted'));
}
$('print').onclick=()=>window.print();
// Camera patch 1.1: visible container before construction and serialized lifecycle.
let cameraQueue=Promise.resolve(),cameraGeneration=0,torch=false;
const cameraStatus=$('cameraStatus');
function cameraTask(task){const next=cameraQueue.then(task);cameraQueue=next.catch(()=>{});return next;}
function cameraMessage(e){
  const text=String(e?.message||e||'Errore fotocamera');
  if(/NotAllowed|PermissionDenied|permission denied/i.test(text))return 'Accesso alla fotocamera negato. Consenti la fotocamera nelle impostazioni del sito.';
  if(/NotFound|DevicesNotFound/i.test(text))return 'Nessuna fotocamera disponibile su questo dispositivo.';
  if(/NotReadable|TrackStart|Could not start/i.test(text))return 'Fotocamera occupata. Chiudi le altre app o schede che la utilizzano e riprova.';
  return 'Fotocamera: '+text;
}
async function releaseCamera(){
  const camera=state.camera;
  if(camera){
    if(state.cameraOn||camera.isScanning)await camera.stop();
    camera.clear();
  }
  state.camera=null;state.cameraOn=false;torch=false;
  $('reader').replaceChildren();$('reader').style.display='none';
  show('camera');show('cameraStop',false);show('torch',false);
}
function stopCamera(){
  cameraGeneration++;
  return cameraTask(async()=>{await releaseCamera();cameraStatus.textContent='Fotocamera ferma';});
}
function startCamera(){
  if(state.cameraOn)return Promise.resolve();
  const generation=++cameraGeneration;
  return cameraTask(async()=>{
    if(document.hidden||generation!==cameraGeneration)return;
    if(!window.Html5Qrcode)throw Error('Libreria scanner non disponibile. Ricarica la pagina e riprova.');
    await releaseCamera();
    const reader=$('reader');
    // Override the old #reader:empty rule before the scanner measures its width.
    reader.style.display='block';reader.style.width=Math.min(reader.parentElement.clientWidth,reader.parentElement.clientHeight*4/3)+'px';reader.style.minHeight='0';reader.style.background='#092d3c';
    $('code').blur();
    cameraStatus.textContent='Avvio fotocamera…';
    const camera=new Html5Qrcode('reader');state.camera=camera;
    try{
      // No fixed crop: scan the complete video, including small/rotated viewports.
      await camera.start({facingMode:'environment'},{fps:12,aspectRatio:4/3},code=>{
        if(generation===cameraGeneration&&state.cameraOn&&!state.busy&&!state.scanHold&&state.view==='scan'&&!$('menuDialog').open&&!$('panelDialog').open&&!document.hidden)scan(code);
      },()=>{});
      state.cameraOn=true;
      if(generation!==cameraGeneration||document.hidden){await releaseCamera();return;}
      const video=reader.querySelector('video');
      if(video){video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.muted=true;video.style.display='block';video.style.width='100%';video.style.height='auto';}
      show('camera',false);show('cameraStop');
      // Optional capability detection must never interrupt a working video stream.
      try{const caps=camera.getRunningTrackCapabilities();show('torch',Boolean(caps?.torch));}catch(e){show('torch',false);}
      cameraStatus.textContent='Fotocamera attiva · inquadra il QR';
    }catch(e){
      try{await releaseCamera();}catch(cleanupError){show('cameraStop');}
      cameraStatus.textContent=cameraMessage(e);
      throw Error(cameraMessage(e));
    }
  });
}
$('camera').onclick=()=>{unlockAudio();guarded(startCamera);};
$('cameraStop').onclick=()=>guarded(stopCamera);
$('torch').onclick=()=>guarded(()=>cameraTask(async()=>{if(!state.cameraOn)return;const next=!torch;await state.camera.applyVideoConstraints({advanced:[{torch:next}]});torch=next;}));
$('settingsTorch').onclick=()=>$('torch').click();
function unlockAudio(){try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();audio.resume();}catch(e){}}
function scan(code,manual=false){
 code=String(code||'').trim();if(!code||state.busy||state.scanHold||Date.now()<boardingResumeAt)return;
 const key=JSON.stringify(context())+'|'+code;
 if(!manual&&state.lastCode===key&&Date.now()-state.lastAt<2500)return;
 unlockAudio();return guarded(async()=>{
  state.scanHold=true;readSound();state.revision++;dismiss();result('pending','VERIFICA IN CORSO…','Attendi la conferma del server.');
  try{
   if(state.uncertain.has(key)){
    const status=await api('lookup',{code});
    if(status.esito==='TROVATO'){state.uncertain.delete(key);result('warn','IMBARCO GIÀ PRESENTE',status.nome+' '+status.cognome+' · '+status.pax+' pax · '+status.port);await refresh();return;}
    if(status.esito==='NON_IMBARCATO'){state.uncertain.delete(key);result('warn','IMBARCO NON PRESENTE','Stato verificato: ripresenta il biglietto per registrarlo.');return;}
    state.uncertain.delete(key);result('error','CHECK-IN NON CONSENTITO',labels[status.esito]||status.esito);return;
   }
   const d=await api('checkin',{code});
   const details=(d.ticket?d.nome+' '+d.cognome+' · '+d.pax+' pax'+(d.counts?' · A '+d.counts[0]+' / B '+d.counts[1]+' / I '+d.counts[2]:'')+' · '+d.port+' · Ticket '+d.ticket:labels[d.esito]||d.esito);
   result(d.esito==='VALIDO'?'success':d.esito==='GIA_USATO'?'warn':'error',d.esito==='VALIDO'?'IMBARCO CONFERMATO':d.esito==='GIA_USATO'?'GIÀ IMBARCATO':'CHECK-IN NON CONSENTITO',details);if(d.ticket){const name=el('div',d.nome+' '+d.cognome,'result-name');$('result').insertBefore(name,$('result').lastChild);$('result').lastChild.textContent=details.slice((d.nome+' '+d.cognome+' · ').length);}sound(d.esito);
   if(d.snapshot)applySnapshot(d.snapshot);else refresh().catch(()=>{});
  }catch(e){state.uncertain.add(key);result('warn','ESITO DA VERIFICARE',e.message+' Ripresentando il biglietto verrà verificato lo stato, senza registrarlo di nuovo.');sound('ERRORE');}
  finally{state.lastCode=key;state.lastAt=Date.now();state.scanHold=false;$('code').value='';}
 });
}
$('scanForm').onsubmit=e=>{e.preventDefault();scan($('code').value,true);};
$('lookupForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{const d=await api('lookup',{code:$('lookupCode').value.trim()});$('lookupDetails').textContent=(d.esito==='TROVATO'?'GIÀ IMBARCATO':labels[d.esito]||d.esito)+(d.ticket?' · '+d.nome+' '+d.cognome+' · '+d.pax+' pax · '+d.port:'');});};
$('undoForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{state.undo=null;show('undoConfirm',false);const code=$('undoCode').value.trim(),d=await api('lookup',{code});$('undoDetails').textContent=d.esito==='TROVATO'?d.nome+' '+d.cognome+' · '+d.pax+' pax · Ticket '+d.ticket:labels[d.esito]||d.esito;if(d.esito==='TROVATO'){state.undo={code,...context()};show('undoConfirm');}});};
// Keep the healthy camera stream alive while leaving the sbarco panel.
async function resumeAfterSbarco(wasOn){
 if(!wasOn||document.hidden||!state.token||!state.port)return;
 const video=$('reader').querySelector('video');
 const tracks=video?.srcObject?.getVideoTracks?.();
 if(state.cameraOn&&tracks?.some(t=>t.readyState==='ended'))await stopCamera();
 if(!state.cameraOn)await startCamera();
 else if(video?.paused)await video.play();
}
$('undoConfirm').onclick=()=>guarded(async()=>{
 if(!state.undo||!confirm('Confermare lo sbarco nel porto '+state.port+'?'))return;
 const request={...state.undo},selected=JSON.stringify(context()),wasOn=state.cameraOn;
 state.revision++;
 show('undoConfirm',false);
 $('undoDetails').textContent='Sbarco in corso… Attendi la conferma del server.';
 let d;
 try{d=await api('undo',request);}
 catch(e){
  state.undo=null;
  $('undoDetails').textContent='ESITO SBARCO DA VERIFICARE. '+e.message+' Cerca nuovamente il biglietto prima di riprovare.';
  result('warn','ESITO SBARCO DA VERIFICARE','Risposta non ricevuta: verifica il biglietto prima di riprovare.');
  throw e;
 }
 state.undo=null;
 if(selected!==JSON.stringify(context())||!state.token)return;
 if(d.esito!=='CHECKIN_ANNULLATO'){
  $('undoDetails').textContent=labels[d.esito]||d.esito;
  result('error','SBARCO NON CONFERMATO',labels[d.esito]||d.esito);
  sound('ERRORE');return;
 }
 // Leave three seconds to remove the ticket before boarding decoding resumes.
 boardingResumeAt=Date.now()+3000;
 state.lastCode=selected+'|'+request.code;state.lastAt=boardingResumeAt;
 state.uncertain.delete(state.lastCode);
 $('undoCode').value='';$('undoDetails').replaceChildren();
 dismiss();
 result('success','SBARCO CONFERMATO',(d.nome||'')+' '+(d.cognome||'')+' · '+d.pax+' pax · '+(d.port||request.port)+' · Rimuovi il QR dalla fotocamera.');
 sound('VALIDO');
 if(d.snapshot)applySnapshot(d.snapshot);else refresh().catch(()=>{});
 try{await resumeAfterSbarco(wasOn);}catch(e){notify('Sbarco confermato. '+cameraMessage(e)+' Premi Avvia fotocamera per riprovare.');}
});
$('close').onclick=()=>guarded(async()=>{if(!state.port)throw Error('Nessun imbarco aperto.');if(!confirm('Salvare il riepilogo di '+state.port+' e terminare questa postazione?'))return;const d=await api('close',{requestId:state.closeId});if(d.esito!=='OK')throw Error(d.esito);dismiss();state.revision++;await stopCamera();state.trip=null;state.port='';state.snapshot=null;show('operation',false);show('setup');notify('Riepilogo salvato nello storico.');await loadTrips();});
let historyRows=[];
function renderHistory(){
 const query=$('historySearch').value.trim().toLocaleLowerCase('it-IT');
 const rows=historyRows.filter(r=>[dateLabel(r.date),r.corsa,r.port,r.operator].join(' ').toLocaleLowerCase('it-IT').includes(query));
 $('historyCount').textContent=rows.length+' riepiloghi'+(query?' trovati':' salvati');
 const root=$('historyContent');root.replaceChildren();
 for(const r of rows){
  const card=el('article',null,'history-card');card.append(reportHeading(r.date,r.corsa,r.port));
  const total=el('div',null,'history-total');total.append(el('span','Imbarcati'),el('strong',(r.stats.imbarcati??0)+' pax'));card.append(total);
  card.append(el('p','Operatore · '+r.operator+' · Chiusura '+new Date(r.closedAt).toLocaleString('it-IT'),'report-muted'));
  const detail=el('details',null,'history-detail');detail.append(el('summary','Dettagli e statistiche'),reportMetrics(r.stats),reportTable(r.stats));
  const b=el('button','Elimina riepilogo','history-delete');b.type='button';
  b.onclick=()=>guarded(async()=>{
   if(!confirm('Eliminare questo riepilogo? I check-in non saranno cancellati.'))return;
   const res=await api('deleteHistory',{id:r.id});if(res.esito!=='OK')throw Error(res.esito);await history();
  });detail.append(b);card.append(detail);root.append(card);
 }
 if(!rows.length)root.append(el('p',query?'Nessun riepilogo corrisponde alla ricerca.':'Nessun imbarco salvato nello storico.','report-empty'));
}
async function history(){
 $('historyCount').textContent='Caricamento storico…';
 try{const d=await api('history');historyRows=d.history;renderHistory();}
 catch(e){$('historyCount').textContent='Storico non aggiornato';throw e;}
}
$('historySearch').oninput=renderHistory;
$('historySetup').onclick=()=>guarded(()=>view('history'));
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera().catch(e=>notify(cameraMessage(e)));else if(state.token&&state.port)refresh().catch(e=>notify(e.message));});
window.addEventListener('offline',()=>notify('Connessione assente. Nessun imbarco può essere confermato.'));

function viewport(){document.documentElement.style.setProperty('--app-height',Math.round(window.visualViewport?.height||innerHeight)+'px');}
window.visualViewport?.addEventListener('resize',viewport);window.addEventListener('resize',viewport);viewport();
serverStatus('unknown','Server: da verificare');serverFreshness();
setInterval(serverFreshness,10000);
window.addEventListener('offline',()=>{serverSequence++;serverStatus('offline','Connessione assente');});
window.addEventListener('online',()=>serverStatus('unknown','Server: da verificare'));
document.addEventListener('visibilitychange',serverFreshness);

// Zebra/DataWedge keyboard output: suffix Enter, outside editable controls.
let wedge='',wedgeAt=0;
document.addEventListener('keydown',e=>{
 if(!state.port||state.view!=='scan'||$('menuDialog').open||$('panelDialog').open||/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(Date.now()-wedgeAt>150)wedge='';wedgeAt=Date.now();
 if(e.key==='Enter'){if(wedge){e.preventDefault();scan(wedge,true);wedge='';}return;}
 if(e.key.length===1)wedge=(wedge+e.key).slice(-2048);
});
