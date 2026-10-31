'use strict';
const $=id=>document.getElementById(id),show=(id,yes=true)=>$(id).hidden=!yes;
const state={token:'',operator:'',trip:null,port:'',snapshot:null,view:'scan',busy:false,camera:null,cameraOn:false,scanHold:false,undo:null,closeId:'',refreshing:false};
const labels={VALIDO:'IMBARCO REGISTRATO',GIA_USATO:'GIÀ IMBARCATO IN QUESTO PORTO',ANNULLATO:'BIGLIETTO ANNULLATO',ALTRA_DATA:'BIGLIETTO DI ALTRA DATA',ALTRA_CORSA:'BIGLIETTO DI ALTRA CORSA',NON_TROVATO:'BIGLIETTO NON TROVATO',PORTO_NON_PREVISTO:'PORTO NON PREVISTO O AMBIGUO',DUPLICATO_ARCHIVIO:'CODICE DUPLICATO IN ARCHIVIO',DATI_NON_VALIDI:'DATI BIGLIETTO DA VERIFICARE',NON_IMBARCATO:'CHECK-IN NON PRESENTE',CHECKIN_ANNULLATO:'CHECK-IN ANNULLATO'};
let noticeTimer,audio;
function notify(message){$('notice').textContent=message;show('notice');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>show('notice',false),7000);}
function dateLabel(v){return /^\d{4}-\d{2}-\d{2}$/.test(v)?v.split('-').reverse().join('/'):v;}
function context(){return {date:state.trip?.date,corsa:state.trip?.corsa,port:state.port};}
async function api(action,params={}){
  const url=window.JBM_CONFIG?.apiUrl||'';
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(url))throw Error('Backend di test non configurato. Impostare config.js dopo aver creato il nuovo progetto Apps Script.');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
  try{
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,token:state.token,...context(),...params}),redirect:'follow',signal:controller.signal,credentials:'omit'});
    if(!response.ok)throw Error('Risposta HTTP '+response.status);
    const d=await response.json();
    if(d.esito==='SESSIONE_SCADUTA'){await reset();throw Error('Sessione scaduta. Accedi nuovamente.');}
    if(['ERRORE','OCCUPATO','ATTENDI','ACCESSO_NEGATO'].includes(d.esito))throw Error(d.message||d.esito);
    return d;
  }catch(e){if(e.name==='AbortError'||e instanceof TypeError)throw Error('Risposta non ricevuta. L’operazione potrebbe essere stata registrata: aggiorna i dati prima di riprovare.');throw e;}
  finally{clearTimeout(timeout);}
}
async function guarded(fn){if(state.busy)return;state.busy=true;const controls=[...document.querySelectorAll('button,input,select')];const previous=controls.map(e=>e.disabled);controls.forEach(e=>e.disabled=true);try{await fn();}catch(e){notify(e?.message||String(e));}finally{controls.forEach((e,i)=>e.disabled=previous[i]);state.busy=false;}}
function sound(ok){try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.connect(g);g.connect(audio.destination);g.gain.value=.1;o.frequency.value=ok?1100:350;o.start();o.stop(audio.currentTime+.2);}catch(e){}}
function el(tag,text,className){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(className)e.className=className;return e;}
async function reset(){await stopCamera();Object.assign(state,{token:'',operator:'',trip:null,port:'',snapshot:null,undo:null,closeId:''});show('workspace',false);show('login');show('operation',false);show('setup');show('history',false);$('password').value='';$('passengers').replaceChildren();$('historyContent').replaceChildren();show('result',false);}
$('loginForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{const d=await api('login',{operator:$('operator').value.trim(),password:$('password').value});state.token=d.token;state.operator=d.operator;$('password').value='';$('welcome').textContent=state.operator;show('login',false);show('workspace');await loadTrips();});};
async function loadTrips(){const d=await api('corse');$('trip').replaceChildren(new Option('Seleziona corsa',''));d.corse.forEach(t=>$('trip').add(new Option(dateLabel(t.date)+' · '+t.corsa,JSON.stringify(t))));$('port').replaceChildren(new Option('Seleziona prima la corsa',''));}
$('trip').onchange=()=>guarded(async()=>{state.trip=$('trip').value?JSON.parse($('trip').value):null;state.port='';$('port').replaceChildren(new Option('Seleziona porto',''));if(!state.trip)return;const d=await api('porti');d.porti.forEach(p=>$('port').add(new Option(p,p)));});
$('start').onclick=()=>guarded(async()=>{if(!$('trip').value||!$('port').value)throw Error('Seleziona corsa e porto.');state.trip=JSON.parse($('trip').value);state.port=$('port').value;state.closeId=crypto.randomUUID();$('tripDate').textContent=dateLabel(state.trip.date)+' · '+state.trip.nave;$('tripTitle').textContent=state.trip.corsa;$('portTitle').textContent='Porto di imbarco: '+state.port;await refresh();show('setup',false);show('operation');await view('scan');});
$('logout').onclick=()=>guarded(async()=>{try{await api('logout');}finally{await reset();}});
$('change').onclick=()=>guarded(async()=>{await stopCamera();state.trip=null;state.port='';state.snapshot=null;show('operation',false);show('setup');await loadTrips();});
async function view(name){await stopCamera();state.view=name;document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==name);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('selected',b.dataset.view===name));if(name==='history')await history();if(name==='list')renderList();if(name==='report'){await refresh();renderReport();}if(name==='scan'){$('code').focus();}if(name==='undo'){state.undo=null;show('undoConfirm',false);$('undoDetails').replaceChildren();}}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>guarded(()=>view(b.dataset.view)));
async function refresh(){if(!state.trip||!state.port||state.refreshing)return;state.refreshing=true;try{const selected=JSON.stringify(context());const d=await api('snapshot');if(selected!==JSON.stringify(context())||!state.token)return;state.snapshot=d.snapshot;renderStats();if(state.view==='list')renderList();if(state.view==='report')renderReport();$('freshness').textContent='Aggiornato alle '+new Date().toLocaleTimeString('it-IT')+(d.snapshot.invalidi?' · '+d.snapshot.invalidi+' biglietti con dati da verificare':'');}catch(e){$('freshness').textContent='Dati non aggiornati · '+e.message;throw e;}finally{state.refreshing=false;}}
setInterval(()=>{if(state.token&&state.port&&!state.busy&&!document.hidden)refresh().catch(()=>{});},10000);
function renderStats(){$('stats').replaceChildren();for(const [k,label] of Object.entries({totale:'Previsti',imbarcati:'Imbarcati',mancanti:'Mancanti',annullati:'Annullati'})){const b=el('button',null,'stat');b.append(el('strong',state.snapshot[k]),el('span',label));b.onclick=()=>guarded(async()=>{$('listState').value=k==='totale'?'all':k;await view(k==='totale'?'report':'list');});$('stats').append(b);}}
function renderList(){if(!state.snapshot)return;const q=$('search').value.trim().toLowerCase(),filter=$('listState').value;const rows=state.snapshot.lista.filter(r=>(filter==='all'||r.state===filter)&&[r.id,r.nome,r.cognome].join(' ').toLowerCase().includes(q));$('passengers').replaceChildren();rows.forEach(r=>{const card=el('div',null,'passenger'),left=el('div');left.append(el('strong',r.nome+' '+r.cognome),el('p','Ticket '+r.id+' · '+r.pax+' pax'));if(r.telefono){const phone=el('a',r.telefono);phone.href='tel:'+r.telefono.replace(/[^+0-9]/g,'');left.append(phone);}card.append(left,el('span',r.state,'state'));$('passengers').append(card);});if(!rows.length)$('passengers').append(el('p','Nessun passeggero trovato.'));}
$('search').oninput=renderList;$('listState').onchange=renderList;
function reportTable(stats){const table=el('table'),head=el('tr');['Stato','Adulti','Bambini','Infant','Totale'].forEach(s=>head.append(el('th',s)));table.append(head);for(const k of ['totale','imbarcati','mancanti','annullati']){const tr=el('tr');[k,...stats.counts[k],stats[k]].forEach(s=>tr.append(el('td',s)));table.append(tr);}return table;}
function renderReport(){if(!state.snapshot)return;$('reportContent').replaceChildren(el('p',dateLabel(state.trip.date)+' · '+state.trip.corsa+' · '+state.port),reportTable(state.snapshot));for(const [op,pax]of Object.entries(state.snapshot.operatori))$('reportContent').append(el('p',op+': '+pax+' pax'));}
$('print').onclick=()=>window.print();
// Camera patch 1.1: visible container before construction and serialized lifecycle.
let cameraQueue=Promise.resolve(),cameraGeneration=0,torch=false;
const cameraStatus=document.createElement('p');
cameraStatus.className='muted small';
cameraStatus.setAttribute('role','status');
$('reader').before(cameraStatus);
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
  return cameraTask(async()=>{await releaseCamera();cameraStatus.textContent='Fotocamera ferma · scanner 1.1';});
}
function startCamera(){
  const generation=++cameraGeneration;
  return cameraTask(async()=>{
    if(document.hidden||generation!==cameraGeneration)return;
    if(!window.Html5Qrcode)throw Error('Libreria scanner non disponibile. Ricarica la pagina e riprova.');
    await releaseCamera();
    const reader=$('reader');
    // Override the old #reader:empty rule before the scanner measures its width.
    reader.style.display='block';reader.style.width='100%';reader.style.minHeight='240px';reader.style.background='#092d3c';
    $('code').blur();
    cameraStatus.textContent='Avvio fotocamera… · scanner 1.1';
    reader.scrollIntoView({block:'center',behavior:'smooth'});
    const camera=new Html5Qrcode('reader');state.camera=camera;
    try{
      // No fixed crop: scan the complete video, including small/rotated viewports.
      await camera.start({facingMode:'environment'},{fps:10},code=>{
        if(generation===cameraGeneration&&state.cameraOn&&!state.busy&&!state.scanHold&&state.view==='scan'&&!document.hidden)scan(code);
      },()=>{});
      state.cameraOn=true;
      if(generation!==cameraGeneration||document.hidden){await releaseCamera();return;}
      const video=reader.querySelector('video');
      if(video){video.setAttribute('playsinline','');video.setAttribute('webkit-playsinline','');video.muted=true;video.style.display='block';video.style.width='100%';video.style.height='auto';}
      show('camera',false);show('cameraStop');
      // Optional capability detection must never interrupt a working video stream.
      try{const caps=camera.getRunningTrackCapabilities();show('torch',Boolean(caps?.torch));}catch(e){show('torch',false);}
      cameraStatus.textContent='Fotocamera attiva · inquadra il QR · scanner 1.1';
    }catch(e){
      try{await releaseCamera();}catch(cleanupError){show('cameraStop');}
      cameraStatus.textContent=cameraMessage(e);
      throw Error(cameraMessage(e));
    }
  });
}
$('camera').onclick=()=>guarded(startCamera);
$('cameraStop').onclick=()=>guarded(stopCamera);
$('torch').onclick=()=>guarded(()=>cameraTask(async()=>{if(!state.cameraOn)return;const next=!torch;await state.camera.applyVideoConstraints({advanced:[{torch:next}]});torch=next;}));
function scan(code){guarded(async()=>{state.scanHold=true;show('result');$('result').className='';$('result').textContent='Verifica in corso…';try{const d=await api('checkin',{code});$('result').className=d.esito==='VALIDO'?'':d.esito==='GIA_USATO'?'warn':'error';$('result').textContent=(labels[d.esito]||d.esito)+(d.ticket?'\n'+d.nome+' '+d.cognome+'\nTicket '+d.ticket+' · '+d.pax+' pax\n'+d.port:'');sound(d.esito==='VALIDO');await refresh();}catch(e){$('result').className='warn';$('result').textContent=e.message;throw e;}finally{setTimeout(()=>state.scanHold=false,2200);$('code').value='';}});}
$('scanForm').onsubmit=e=>{e.preventDefault();if(!state.scanHold)scan($('code').value.trim());};
$('undoForm').onsubmit=e=>{e.preventDefault();guarded(async()=>{state.undo=null;show('undoConfirm',false);const code=$('undoCode').value.trim(),d=await api('lookup',{code});$('undoDetails').textContent=d.esito==='TROVATO'?d.nome+' '+d.cognome+' · '+d.pax+' pax · Ticket '+d.ticket:labels[d.esito]||d.esito;if(d.esito==='TROVATO'){state.undo={code,...context()};show('undoConfirm');}});};
$('undoConfirm').onclick=()=>guarded(async()=>{if(!state.undo||!confirm('Annullare il check-in nel porto '+state.port+'?'))return;const d=await api('undo',state.undo);notify(labels[d.esito]||d.esito);state.undo=null;show('undoConfirm',false);$('undoDetails').replaceChildren();await refresh();});
$('close').onclick=()=>guarded(async()=>{if(!confirm('Salvare il riepilogo di '+state.port+' e terminare questa postazione?'))return;const d=await api('close',{requestId:state.closeId});if(d.esito!=='OK')throw Error(d.esito);await stopCamera();state.trip=null;state.port='';state.snapshot=null;show('operation',false);show('setup');notify('Riepilogo salvato nello storico.');await loadTrips();});
async function history(){const d=await api('history');$('historyContent').replaceChildren();d.history.forEach(r=>{const card=el('article',null,'history-item');card.append(el('h3',dateLabel(r.date)+' · '+r.corsa),el('p',r.port+' · '+r.operator+' · '+new Date(r.closedAt).toLocaleString('it-IT')),reportTable(r.stats));const b=el('button','Elimina riepilogo','ghost');b.onclick=()=>guarded(async()=>{if(!confirm('Eliminare questo riepilogo? I check-in non saranno cancellati.'))return;const res=await api('deleteHistory',{id:r.id});if(res.esito!=='OK')throw Error(res.esito);await history();});card.append(b);$('historyContent').append(card);});if(!d.history.length)$('historyContent').append(el('p','Nessun imbarco nello storico JBM.'));}
$('historySetup').onclick=()=>guarded(async()=>{show('setup',false);await view('history');});
$('historyBack').onclick=()=>guarded(async()=>{show('history',false);if(state.port)await view('scan');else show('setup');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera().catch(e=>notify(cameraMessage(e)));else if(state.token&&state.port)refresh().catch(e=>notify(e.message));});
window.addEventListener('offline',()=>notify('Connessione assente. Nessun imbarco può essere confermato.'));
