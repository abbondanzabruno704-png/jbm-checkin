# JBM – JUMBO MARE CHECK-IN

Versione 1.0 di collaudo. Frontend statico per GitHub Pages, backend Apps Script e archivio Google Sheets. Nessuna risorsa esterna è stata creata o pubblicata durante la preparazione di questo pacchetto.

## Stato e limiti di verifica

Il codice è stato ricostruito a partire dai due sorgenti forniti e da ARCHIVIO.xlsm. I test locali verificano logica di validazione, isolamento degli scali, conteggi e operazioni backend con servizi Google simulati. Non sostituiscono il collaudo del deployment Apps Script e dei dispositivi reali. La comunicazione cross-origin POST, autorizzazioni, fotocamera, torcia e DataWedge devono essere provati su iPhone, Android e Zebra prima dell'uso operativo.

Il pacchetto è esclusivamente TEST. Non configura il foglio originale: il suo ID è esplicitamente bloccato nel backend. La vecchia applicazione e il vecchio repository restano invariati. Non sono inclusi dati personali, credenziali originali o il precedente endpoint.

## Contenuto

- `index.html`, `style.css`, `app.js`, `config.js`: frontend GitHub Pages.
- `backend/Code.gs`, `backend/Core.js`, `backend/appsscript.json`: nuovo backend.
- `tests/checkin.test.cjs`: test eseguibili con `node --test tests/checkin.test.cjs`.
- `docs/ANALISI.md`: dati verificati, compatibilità e scelte.
- `docs/COLLAUDO.md`: prove richieste nell'ambiente Google e sui dispositivi.

## Configurazione guidata, solo dopo conferma

1. Creare una COPIA del Google Sheet originale chiamata `JBM_CHECKIN_TEST`. Usare File → Crea una copia e non condividere pubblicamente i dati. Copiare il suo ID dall'URL. Disabilitare eventuali automazioni/importazioni della copia che scrivano nell'originale. Il nuovo backend non usa il vecchio progetto né i suoi trigger.
2. Creare un progetto Apps Script NUOVO e indipendente, `JBM CHECK-IN TEST`, su script.google.com. Copiare Code.gs. Creare il file Core e incollarvi Core.js (Apps Script lo salverà come Core.gs). Impostare il fuso Europe/Rome; se si sostituisce il manifest, usare quello incluso.
3. In Impostazioni progetto → Proprietà script aggiungere `ENVIRONMENT` = `TEST`, `TEST_SPREADSHEET_ID` = ID della COPIA e `ACCESS_PASSWORD` = una NUOVA password di almeno 12 caratteri. Non mettere password nel frontend o nel repository. Il nome operatore è dichiarato dall'operatore, non un account personale verificato.
4. Dopo conferma di pubblicazione, distribuire il nuovo progetto come applicazione web eseguita dal proprietario, accessibile a chiunque. Il backend richiede comunque una sessione per ogni azione sui dati. Le policy Google Workspace potrebbero impedire questa modalità: verificarle prima del collaudo. Copiare solo il nuovo URL `/exec` in `config.js`.
5. Dopo conferma, creare `abbondanzabruno704-png/jbm-checkin`. Caricare questi sorgenti senza archivi originali o credenziali. Il repository precedente non va rinominato, sostituito o cancellato. La disponibilità di Pages su repository privati dipende dal piano GitHub; se si usa un repository pubblico, contiene solo codice privo di segreti.
6. Dopo conferma, in Settings → Pages scegliere Deploy from a branch → main → /(root). Il frontend risultante avrà il percorso `/jbm-checkin/`. Non attivare Pages sul vecchio repository e non configurare un dominio che lo sostituisca.
7. Eseguire tutte le prove di `docs/COLLAUDO.md`. Il passaggio a produzione richiede una fase distinta e autorizzata: questa versione blocca intenzionalmente il foglio originale.

## Uso

Accesso con password comune e nome operatore, selezione corsa e porto. Scansione fotocamera oppure inserimento di numero/QR. I dispositivi Zebra devono usare DataWedge con output tastiera e suffisso Invio; il campo codice deve essere selezionato. La fotocamera parte solo su richiesta. La torcia appare se il dispositivo ne dichiara il supporto.

I contatori si aggiornano ogni 10 secondi e dopo le operazioni. Mostrano passeggeri, non numero di biglietti, per data/corsa/porto. Il biglietto con più passeggeri viene imbarcato interamente, come nella vecchia app. Nessuna scansione offline viene accodata come confermata. In caso di risposta persa controllare lista e contatori: il server potrebbe aver salvato l'operazione. Una seconda scansione dello stesso ticket e porto restituisce già imbarcato.

Termina salva un riepilogo del porto e chiude la postazione locale: non chiude globalmente la corsa per gli altri operatori. Un ID rende la ripetizione della medesima richiesta di chiusura idempotente. Una nuova postazione può produrre un nuovo riepilogo. Storico_JBM è separato dal vecchio Storico, che non viene modificato né migrato automaticamente. I vecchi riepiloghi restano disponibili nella vecchia app.

Le sessioni restano in memoria del browser, scadono entro 6 ore e possono scadere prima per espulsione dalla cache Google. Ricaricando la pagina occorre accedere di nuovo. Cambiare password non revoca immediatamente tutte le sessioni esistenti.

## Dipendenze e protocollo

html5-qrcode 2.3.8 caricato da unpkg; font opzionali da Google Fonts con fallback di sistema. È necessaria una connessione. Il frontend invia JSON con Content-Type text/plain, senza header personalizzati, e segue il redirect di ContentService. Non si usa JSONP per modifiche ai dati. Documentazione: https://developers.google.com/apps-script/guides/content e https://developers.google.com/apps-script/guides/web .

## Vincoli

LockService serializza le operazioni di questo nuovo progetto, ma non coordina scritture da altri progetti o da Excel: la copia di test deve essere isolata. Un porto ripetuto in due scali è rifiutato come ambiguo. Gli scali sono letti dalle colonne archivio, non ricavati dal QR. Le colonne legacy Z–AB restano invariate. Intestazioni mancanti/duplicate impediscono l'operazione. Una riga incompleta è esclusa; conteggi non coerenti vengono segnalati e non imbarcati. Il limite globale di accesso è 30 tentativi/minuto: adatto al collaudo, da dimensionare prima di un servizio con molti operatori.
