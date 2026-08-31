# ESP IDE Simulator Lite – předání vývoje další AI

Aktualizováno: 2026-08-25

Tento dokument je pracovní zadání a architektonická kontrola pro další AI,
která bude pokračovat ve vývoji `simulator_lite/`. Popisuje současné vrstvy,
známé chyby, technická rizika, doporučené opravy, pořadí práce a způsob
ověření. Není to náhrada stručného uživatelského `README.md`; obsahuje záměrně
více implementačních detailů.

## 0. Stav této etapy (2026-08-25)

V této etapě byly implementovány a staticky/headless ověřeny tyto části:

- fáze A: DOM-free model kvadraturního enkodéru, počáteční A/B/SW úrovně,
  pointer capture a ovládání `+`/`−`, validátor konfigurace, canvas 520 px a
  explicitní sdílení GPIO 19/20 motorů;
- jednotný RPC lifecycle s timeouty, monotónními ID, odmítnutím pending
  požadavků při restartu/destroy/chybě Workeru a kontrolou verze protokolu;
- Worker fronta pro `run`, `exec`, REPL a operace filesystému, explicitní
  `BUSY`, urgentní interrupt a stavový automat `BOOTING/READY/RUNNING/STOPPING`;
- reset lifecycle virtuálních `Pin`/`PWM`, odstranění dvojího pollingu,
  dávkování GPIO/PWM/NeoPixel výstupů, DOM aktualizace v RAF a suspend/resume;
- distribuční základ se načítá z `simulator_lite/filesystem/`, IndexedDB overlay
  se aplikuje před `boot.py`/`main.py`, ale při nové relaci ESP IDE se jednou
  smaže; cache token vlastních modulů se přebírá z `APP_VERSION` hostitele;
- `Scene` používá rozšiřitelný registr factory funkcí místo typového řetězce
  `if`; skutečný WASM friendly/raw REPL, raw chybový kanál a binární zápis jsou
  pokryty headless testem a bridge má Filemanager bufferové API;
- Worker má I2C registry, standardní `machine.I2C` operace a samostatný SSD1306
  model. Reálný distribuovaný `oled.py` v headless WASM testu vykreslí krajní
  pixely framebufferu přes SoftI2C i dostupnost přes I2C(0).
- enkodér lze otáčet kruhovým tažením myši i kolečkem; serva, motory a enkodér
  zobrazují aktuální úhel, rychlost nebo počet kroků; interakce enkodéru má
  vždy jeden detent na krok ovládání a třikrát rychlejší animaci kvadraturních
  přechodů;
- virtuální `machine.Pin` podporuje pull-up/pull-down, hrany i úrovňové IRQ,
  běžné mode/drive/hold nastavení a exportuje `disable_irq()`/`enable_irq()`;
- `esp_ide_v2/.htaccess` izoluje i horní dokument pomocí COOP a COEP
  `credentialless`. Samotné hlavičky iframe nestačí: bez izolovaného parentu se
  karta enkodéru hýbe, ale blokovaný Worker nepřevezme A/B `postMessage`;
- `/home`, `/proc` a `/tmp` se po startu Emscripten MEMFS odstraní. `/dev`
  musí zůstat kvůli TTY/REPL, ale Worker i `fm_rpc.py` ho v uživatelském
  výpisu skrývají;
- OLED používá bitmapové tělo a konfigurovaný framebuffer výřez. Karta a
  popisek přebírají světlé/tmavé CSS proměnné ESP IDE. Dynamický canvas zůstává
  nejméně 128×64 px a do výřezu se zvětšuje pouze celočíselným násobkem; pokud
  je výřez menší, canvas se vycentruje, zůstane celý viditelný a jeho počátek se
  zarovná na celé CSS pixely bez zmenšení pod 1×;
- kooperativní `machine._poll()` průběžně flushuje i hardwarové události, takže
  OLED/GPIO/PWM nezůstanou čekat na browserový timer uvnitř `while True`;
- kooperativní checkpoint má minimální periodu 5 ms, I2C respektuje virtuální
  frekvenci sběrnice a OLED model vytváří framebuffer snapshot až při dávkovaném
  flushi. Checkpoint už neobchází 16ms limit publikování hardwarových událostí;
- Worker verzuje také své importované JS moduly a načítané Python runtime
  soubory; samotný query parametr na `worker.js` nestačí k invalidaci jeho
  závislostí v browserové cache;
- Display Designer používá pro target Simulator přímý binární framebuffer RPC
  do virtuálního OLED a není závislý na Python globálech `buffer`/`display`;
- hlavička panelu nabízí potvrzovaný `Tovární reset FS`, který odstraní
  IndexedDB overlay a znovu načte distribuční filesystém.
- `ADC.read_uv()` vrací napětí 0 až 3 300 000 mikrovoltů s milivoltovým
  rozlišením; 65535 odpovídá 3,3 V. Runtime má také host-clock `RTC`, virtuálně
  připojené `network.WLAN`, `ntptime.settime()` a `urequests.get()` přes
  asynchronní browserový `fetch` a omezený same-origin PHP proxy endpoint;
- přibyly komponenty analogového joysticku (dva ADC vstupy a aktivní-low
  tlačítko, Pointer Events pro myš i dotyk) a DHT22 s nastavitelnou teplotou a
  vlhkostí. DHT posuvníky mají CZ/EN/DE popisky a vizuální výchylka hlavice
  joysticku je poloviční bez omezení ADC rozsahu. Jejich MicroPython API jsou
  pokryta přímým WASM testem;
- ukotvený panel při minimalizaci a návratu zachovává poslední scroll pozici
  scény v docku v `localStorage`;
- toolbox targetu Simulator používá výchozí piny první odpovídající komponenty
  z `config/default.json`; druhé servo a druhý DC motor vyžadují ruční změnu
  pinů, protože toolbox má pro každý typ jediný inicializační blok;
- joystick zobrazuje osy v procentech, servo 360° a DC motory zobrazují pouze
  rychlost v procentech a spuštění zelenou šipkou vypíše do terminálu
  `run_code()`;
- návrat z jiného targetu zpět na Simulator znovu naváže hostitelský bridge
  přes RPC `resume`; starý vyřešený `readyPromise` se už nepoužívá jako falešné
  potvrzení připojení. Duplicitní posluchač změny targetu byl odstraněn a
  verze ESP IDE byla zvýšena na `2026-08-21-v2.0.200`, aby se nevracel starý
  bridge z browserové cache.

V browseru jsou nyní potvrzeny OLED data, tažení i kolečko enkodéru včetně
Python IRQ hodnot, pull-up/pull-down, přepnutí motivu a Display Designer live
preview. Uživatel však nově reprodukoval kritickou chybu otevření Filemanageru
za běhu programu, který zapisuje do konzole: první `fm_list()` může skončit
`RPC_REMOTE_ERROR` s `KeyboardInterrupt` uvnitř `machine._poll()`. Podrobnosti,
návrh opravy a regresní scénáře jsou v kapitole 4.7. Stále nejsou potvrzeny
všechny operace Filemanageru, Ctrl+C ve všech stavech a ztráta iframe/Workeru.
Před veřejným nasazením COEP `credentialless` samostatně ověř externí iframe
instalátoru a doplňků, zejména pokud by jejich serverová relace používala cookies.
Další I2C zařízení, socket endpointy a širší Worker integrační harness jsou
vhodné pro výkonnější AI.

### 0.1 Rychlý přehled stavu

| Oblast | Stav | Co ještě chybí |
| --- | --- | --- |
| Worker, RPC a stop programu | základ hotový | atomický přechod z běžícího programu do servisní relace Filemanageru |
| Filesystem | hotový persistentní overlay a tovární reset | odolnost při pádu Workeru u právě rozepsaného souboru a velké soubory |
| Friendly/raw REPL | headless ověřeno | úplná živá matice Ctrl+C, raw/friendly přechodů a současného výstupu |
| Filemanager | transport a buffer hotové | P0 chyba z kapitoly 4.7 a živé ověření všech operací |
| `Pin`, pull a IRQ | hlavní API hotové | přesnější matice kompatibility s ESP32 quickref a dlouhé stresové testy |
| `ADC`, RTC a síťové moduly | `read_uv`, host-clock RTC, virtuální WLAN, NTP a HTTP GET hotové | širší `network.status/config`, HTTP metody, hlavičky a řízené chybové stavy |
| Enkodér, serva a motory | funkční a živě ověřené | pouze další měření výkonu ve složité scéně |
| Joystick a DHT22 | model, UI a MicroPython API hotové | živý mobilní dotykový test a případné kalibrační nastavení os |
| I2C a OLED SSD1306 | funkční a živě ověřené | další zařízení, úplnější chybové stavy sběrnice a stresové testy |
| Display Designer preview | funkční bez závislosti na Python globálech | kolize s Filemanager/REPL servisní relací |
| Výkon | 5ms checkpoint, virtuální čas I2C a 16ms batching hotové | měřit CPU, latenci vstupů a dlouhé běhy, nehodnotit jen FPS |
| Lifecycle targetu | návrat `jiný target → Simulator` obnovuje iframe přes `resume` | automatický Worker/iframe reconnect test a obnova po ztrátě iframe |
| Cache a nasazení | Worker závislosti se verzují | odstranit ručně opakované build ID a ověřit COEP s externími iframe |

### 0.2 Priority dalšího vývoje

1. **P0 – Filemanager:** vyřešit závod `stop -> Ctrl+C -> fm_list()` a zavést
   výhradní servisní relaci VM podle kapitoly 4.7.
2. **P1 – integrační test Workeru:** automaticky reprodukovat běžící program,
   proud stdout, zastavení a následný Filemanager příkaz ve skutečném Workeru.
3. **P1 – kompatibilita MicroPython ESP32:** vytvořit tabulku podporovaných API
   podle ESP32 quickref a doplňovat nejpoužívanější chybějící části po malých
   testovatelných celcích.
4. **P2 – spolehlivost a výkon:** stresové testy IRQ, OLED, serva, konzole,
   velkých souborů a opakovaných restartů; doplnit měření CPU a latencí.
5. **P3 – nové periferie:** až potom další I2C modely a bezpečně omezené socket
   endpointy. Nepřidávat nové periferie před uzavřením P0.

## 1. Nejdůležitější rozhodnutí

Pokračuj v `simulator_lite/`. Nezakládej další simulátor a nepřenášej zpět
komplexní profilový systém z původního `simulator/`.

Současná základní architektura je správná:

```text
ESP IDE
  └─ ide-bridge.js                 jediná IDE-specifická integrační vrstva
       └─ iframe / frame-bridge.js izolace dokumentu a postMessage protokol
            ├─ SimulatorLiteController
            ├─ Scene
            └─ Worker
                 ├─ MicroPython WASM
                 ├─ virtuální filesystem
                 └─ machine.py / simhw

Standalone stránka
  └─ stejný Controller + Scene + Worker
```

Zachovej následující principy:

- MicroPython vždy běží ve Workeru, nikdy v hlavním vlákně ESP IDE.
- ESP IDE nesmí znát vnitřnosti Workeru ani komponent; používá pouze transport.
- Vložený režim ESP IDE zobrazuje jen scénu. Editor, konzole, REPL a ovládání
  programu patří ESP IDE.
- Standalone režim může mít vlastní editor, konzoli a ovládací tlačítka.
- Distribuční filesystém by nově měl vycházet z `\simulator_lite\filesystem\`, bez hashovacího katalogu a ZIP profilů. Při spuštění simulátoru je potřeba vytvořit nový filesystém v Micropythonu, z dodaných souborů a do nového načtení editoru udržovat tento filesystém perzistentní, s podporou file open, read a write z Micropythonu.
- `toolbox_Simulator.xml` je samostatná kopie ESP32-S3 toolboxu a může se dále
  vyvíjet nezávisle.
- Konfigurace scény má zůstat obyčejný čitelný JSON.
- Nepřidávej framework, bundler nebo rozsáhlou abstrakční vrstvu bez konkrétní
  potřeby. Cílem je malý, čitelný a snadno přenositelný simulátor.

## 2. Pravidla práce v repozitáři

Před každou změnou:

1. Přečti `C:\xampp\htdocs\AGENTS.md` a při zásahu do ESP IDE také
   `esp_ide_v2/AGENTS.md`.
2. Spusť `git status --short` a zachovej všechny existující změny uživatele.
3. Hledej cíleně pomocí `rg`; neprocházej ani neupravuj vendored
   `micropython.mjs`.
4. Měň pouze zdrojové soubory. Nepřepisuj Blockly distribuce ani minifikované
   soubory, pokud úkol výslovně nevyžaduje jejich zdrojový build.
5. Pro úpravy používej `apply_patch`.
6. Prohlížečové a lidské interakční testy neprováděj, pokud je uživatel znovu
   výslovně nevyžádá. Uživatel si je v této fázi provádí sám.
7. Ve výsledku odděl statické testy, prohlížečové testy a testy na fyzickém
   zařízení. Neprovedený test nikdy neoznačuj jako úspěšný.

Staré adresáře `simulator/`, `sim_test/` a `sim_test2/` používej pouze jako
referenci. Bez přímého zadání je neupravuj.

## 3. Současné moduly a jejich odpovědnosti

| Soubor | Současná odpovědnost | Poznámka |
| --- | --- | --- |
| `app.js` | start standalone/iframe stránky | Určuje `sceneOnly` podle `?embed=1`. |
| `embed.js` | UI shell, Worker lifecycle, RPC klient, signály a veřejné API | Má příliš mnoho odpovědností; později rozdělit jedním čistým řezem. |
| `frame-bridge.js` | překlad postMessage požadavků na Controller | Má zůstat malý a bez znalosti ESP IDE DOM. |
| `ide-bridge.js` | panel ESP IDE a emulace transportu zařízení | Jediný modul, který smí znát DOM a terminál ESP IDE. |
| `worker.js` | start WASM, REPL, FS, HW most a router zpráv | Kritické místo pro serializaci příkazů a backpressure. |
| `runtime/machine.py` | kompatibilní `machine.Pin/PWM/ADC/I2C/SPI` | Nejde o úplnou emulaci ESP32; podporu je nutné deklarovat. |
| `runtime/fs-loader.js` | přímé binární načtení `files.lst` | Zachovat bez runtime hashů. |
| `core/scene.js` | DOM scény, modely komponent a vstupy | Před OLED zavést registr komponent a oddělit složité modely od DOM. |
| `core/angle.js` | čisté výpočty serv a rotace | Vhodný vzor pro další testovatelné modely. |
| `config/default.json` | plocha, komponenty, pozice, vlastnosti a piny | Má být jediným zdrojem rozmístění. Potřebuje validátor. |
| `toolbox_Simulator.xml` | samostatný toolbox targetu Simulator | Aktuálně přesná kopie ESP32-S3. |

## 4. Kritické problémy – opravit před novými periferiemi

### 4.1 Jedna MicroPython instance nemá jednotnou příkazovou frontu

> **Stav 2026-08-21: základ opraven, servisní předání není atomické.** VM fronta,
> stavový automat, `BUSY` a urgentní interrupt jsou implementované. Zůstává
> závod mezi potvrzením požadavku Stop a skutečným návratem VM do `READY`, který
> se nyní projevil při otevření Filemanageru; viz kapitola 4.7.

#### Původní stav

`worker.js` používá asynchronní `message` listener. Sériově je řešena pouze
fronta znaků `replQueue`. Ostatní operace (`run`, `exec`, `write-file`,
`read-file`, `list-files`) mohou být doručeny, zatímco MicroPython v Asyncify
čeká uvnitř jiné operace.

To vytváří riziko reentrantního přístupu k jedné WASM instanci a jejímu FS.
Nejpravděpodobnější projevy jsou nepravidelné záseky, poškozené pořadí REPL
odpovědí nebo souborová operace provedená během běhu programu.

#### Požadovaná oprava

Zaveď v runtime jediný stavový automat a jednu VM frontu:

```text
BOOTING -> READY -> RUNNING -> STOPPING -> READY
                    \-> FAILED
```

Do fronty patří všechny operace, které volají MicroPython nebo Emscripten FS:

- `run`,
- `exec`,
- zpracování znaků REPL,
- zápis, čtení a výpis souborů,
- budoucí reset nebo synchronizace persistentního FS.



Mimo frontu smějí procházet pouze urgentní nebo čistě signálové zprávy:

- Ctrl+C přes řídicí slot `SharedArrayBuffer`,
- digitální vstup,
- ADC,
- případně budoucí vstupní IRQ příznak.

Pokud operace při stavu `RUNNING` není bezpečná, vrať explicitní chybu
`BUSY`, místo aby byla spuštěna souběžně. Stop musí zůstat urgentní a nesmí
čekat za běžným příkazem.

Rozlišuj dvě události spuštění:

- požadavek `run` byl přijat,
- program skutečně skončil (`done`, `interrupted`, `error`).

#### Kontrola

Přidej bezprohlížečové testy s falešnou VM:

- dvě `exec` operace se provedou přesně v pořadí,
- `write-file` během `RUNNING` se odmítne nebo počká podle zvoleného kontraktu,
- `interrupt` projde okamžitě i při obsazené VM frontě,
- každý request dostane právě jednu odpověď,
- chyba jedné operace nezastaví celou frontu.

### 4.2 RPC požadavky nemají timeout ani korektní zrušení

> **Stav 2026-08-21: obecný RPC lifecycle opraven.** Požadavky mají timeout,
> pending Promise se při restartu, destroy a chybě odmítnou a ID jsou monotónní.
> Timeout ale nenahrazuje potvrzení dokončeného stavového přechodu VM; právě to
> je chybějící část servisní relace Filemanageru.

#### Původní stav

`embed.js` i `ide-bridge.js` ukládají Promise do `pending`. Při `restart()` a
`destroy()` se mapa pouze vymaže. Volající pak může čekat navždy. Stejný
problém nastane, pokud Worker nebo iframe přestane odpovídat.

#### Požadovaná oprava

Vytvoř malou společnou pomocnou třídu nebo funkci pro RPC lifecycle:

- každý požadavek má timeout,
- timeout odstraní položku z `pending` a Promise odmítne,
- restart, destroy a chyba Workeru odmítnou všechny čekající požadavky
  konkrétní chybou, například `RUNTIME_RESTARTED`,
- pozdní odpověď na již ukončený request se bezpečně ignoruje,
- `requestId` zůstává monotónní v rámci jednoho controlleru.

Nedělej jeden příliš krátký timeout pro všechny operace. Start WASM a větší
soubor mohou mít samostatný delší limit, běžné řídicí RPC kratší.

#### Kontrola

- request bez odpovědi skončí předvídatelnou chybou,
- restart odmítne všechny pending Promise,
- po restartu funguje nový request,
- `pending.size` je po timeoutu, restartu a destroy vždy nula.

### 4.3 Virtuální filesystem se při restartu ztrácí

> **Stav 2026-08-21: opraveno explicitním overlayem.** Vendored runtime nemá
> IDBFS, proto Worker po načtení distribučního MEMFS aplikuje binární overlay z
> IndexedDB před `boot.py` a `main.py`. Běžný reset overlay zachová a samostatný
> `factoryResetFilesystem()` jej odstraní; stejnou operaci nabízí potvrzované
> tlačítko `Tovární reset FS` v panelu ESP IDE. Behaviorální test pokrývá změnu a
> odstranění souboru, prázdný adresář i bezeztrátové `.raw`, `.mpy`, `.dat` a
> `.mfnt`.

#### Původní stav

`restart()` ukončí Worker. Nový Worker znovu vytvoří MEMFS pouze z
`files.lst`. Nahraný `idecode`, uživatelské knihovny i upravený `boot.py` nebo
`main.py` zmizí.

To neodpovídá fyzickému zařízení. Je to kritické také v režimu bez
`SharedArrayBuffer`, kde nouzový Stop restartuje celý Worker.

#### Cílový model

Filesystem rozděl na dvě vrstvy:

```text
distribuční základ z files.lst
  + zapisovatelný uživatelský overlay
  = filesystem viditelný MicroPythonu
```

Pořadí startu musí být:

1. vytvořit MEMFS,
2. načíst základ z `files.lst`,
3. aplikovat uživatelský overlay,
4. teprve potom spustit uživatelskou verzi `boot.py`,
5. následně spustit uživatelskou verzi `main.py`,
6. inicializovat REPL.

Reset procesoru musí overlay zachovat. Samostatná operace „obnovit tovární
filesystem“ jej smí vymazat.

Preferovaný dlouhodobý backend je IndexedDB použitelná standalone i v iframe.
Nejprve ověř, zda vendored Emscripten build bezpečně podporuje IDBFS. Pokud ne,
začni explicitním overlayem pro soubory zapisované ESP IDE a omezení jasně
zdokumentuj. Pamatuj, že soubory může zapisovat také samotný Python program;
řešení zachycující pouze `sendFile()` proto není úplná emulace.

Neměň `files.lst` na hashovaný manifest. Persistence uživatelského overlaye
je jiný problém než verzování distribučních souborů.

#### Kontrola

- zapiš `/idecode`, restartuj procesor a ověř shodné bajty,
- změň `/boot.py`, restartuj a ověř, že se spustila změněná verze,
- binární `.raw`, `.mpy`, `.dat` a `.mfnt` musí přežít beze změny,
- tovární reset odstraní overlay a obnoví základ z `files.lst`,
- nouzový restart Workeru nesmí smazat soubory nahrané ESP IDE.

### 4.4 Tlačítko rotačního enkodéru je nyní chybné

> **Stav 2026-08-21: opraveno a živě ověřeno.** Tlačítko má oddělený
> `setPressed`, A/B/SW mají počáteční úrovně, kvadraturní model frontuje rychlé
> kroky a kruhové pointer tažení převádí změnu úhlu na detenty. Fungují také
> tlačítka `+`/`−` a kolečko myši; UI zobrazuje kroky a souvislý úhel.

#### Příčina

V `core/scene.js` je `component.press` nejprve funkce, která mění GPIO. Po
registraci event listenerů je ale stejná vlastnost přepsána DOM elementem
tlačítka. Event handler pak při stisku zkouší zavolat element jako funkci.
Encoder nejde myší otáčet nemá ani tlačítka + a - na otočení o jeden krok.

#### Požadovaná oprava

Použij oddělené názvy, například:

```js
setPressed(value)       // mění GPIO
pressButton             // DOM element
```

Současně:

- při inicializaci nastav A=0, B=0 a SW=1 pro aktivní-low tlačítko,
- použij pointer capture,
- obsluž `pointerup`, `pointercancel` a `lostpointercapture`,
- při `destroy()` zruš rozpracovaný timer kvadraturních přechodů.
- doplň ovládací prvky pro encoder.

#### Kontrola

Čistý test modelu enkodéru musí ověřit:

- krok doprava: čtyři správné kvadraturní stavy,
- krok doleva: opačné pořadí,
- několik rychlých kroků neztratí směr,
- SW přejde při stisku na 0 a při všech cestách uvolnění na 1,
- žádný handler nevolá DOM element jako funkci.

### 4.5 Registry `Pin` roste při každém spuštění programu

> **Stav 2026-08-21: opraveno pro současné `Pin` a `PWM`.** Před novým
> `run_code()` se volá `machine._reset_simulator_state()`, staré IRQ handlery se
> nepřenášejí a polling interruptu je sjednocen. Jakmile přibudou Timer, sockety
> nebo další stavové periferie, musí se připojit ke stejnému lifecycle.

#### Původní stav

`runtime/machine.py` ukládá každou instanci `Pin` do globálního
`Pin._instances`. Staré instance se neodstraňují. Opakované spuštění programu
proto zachová staré IRQ handlery a každý poll prochází stále delší seznam.

#### Požadovaná oprava

Přidej explicitní lifecycle virtuálního hardwaru, například interní funkci
`machine._reset_simulator_state()`, která před novým `run_code()`:

- odstraní staré `Pin` instance a IRQ handlery,
- deinicializuje PWM,
- zruší budoucí Timer objekty,
- uzavře budoucí socket endpointy,
- podle zvoleného kontraktu nastaví výstupy do počátečního stavu.

Neprováděj tento reset při každém jednotlivém `exec` příkazu v REPL. Musí být
jasně svázán se startem nového programu nebo úplným resetem zařízení.

V `_poll()` se nyní `poll_interrupt()` volá přímo a poté znovu uvnitř
`Pin._poll_all()`. Sjednoť to na jedno místo.

#### Kontrola

- spusť stejný program s IRQ stokrát,
- počet aktivních virtuálních Pin objektů se nesmí zvyšovat,
- jedna hrana vyvolá právě jeden aktuální handler,
- starý handler z předchozího programu se nesmí zavolat.

### 4.6 REPL musí být věrnou kopií REPLu přes sériovou linku

> **Stav 2026-08-21: raw transport opraven, Filemanager má potvrzenou chybu.** Bridge
> posílá Ctrl+A, Ctrl+B, Ctrl+C a raw EOT do skutečného WASM REPL procesoru,
> parsuje oddělený stdout/stderr raw rámec a poskytuje `fmEnable`, `fmClear`,
> `fmPeek` i `fmTakeAll` nad 256KiB bufferem. Headless test běží nad skutečným
> `micropython.wasm`. Otevření Filemanageru po zastavení aktivního programu může
> selhat opožděným `KeyboardInterrupt`; viz kapitola 4.7.

Display Designer už pro target Simulator raw REPL nepoužívá. Jeho dočasné
funkce se instalují přímým `sendCommand()` do stejného globálního prostoru;
WASM regresní test i živý prohlížeč ověřují `READY`, přenos 1024 bajtů a
`display.show()` s výsledným OLED snímkem.

#### Původní stav

Repl předstírá přechod do RAWRepl a nefunguje Filemanager ani funkce z repl_web_usb_serial.js

#### Požadovaná oprava

Musí projít všechny komunikační funkce z repl_web_usb_serial.js a musí správně komunikace s Filemanagerem

#### Kontrola

Po otevření Filemanageru, se korektně načtou soubory z vnitřního filesystému včetně perzistentních souborů uživatele.

### 4.7 P0: Filemanager po zastavení běžícího programu převezme `KeyboardInterrupt`

#### Pozorovaný problém

Když uživatelský program běží a průběžně píše do konzole, otevření Filemanageru
může při prvním listingu skončit chybou:

```text
RPC_REMOTE_ERROR ... fm_rpc.py ... fm_list
machine.py ... _sim_sleep_ms -> _sim_sleep -> _poll -> Pin._poll_all
KeyboardInterrupt
worker.js ... mp.runPython(String(data.code || ''))
```

Jde o potvrzenou živou chybu. Není to chyba obsahu adresáře ani persistence:
`F.fm_list()` se již spustí, ale při jeho `sleep_ms(pause)` dostane přerušení,
které mělo ukončit předchozí uživatelský program.

#### Doložená cesta a pravděpodobná příčina

- `openFM()` v ESP IDE nejprve volá `await stopCode()` a potom načte Filemanager.
- Filemanager má vlastní `withReplLock`, ten však serializuje pouze jeho vlastní
  JavaScript operace. Nevlastní stav Workeru ani celou VM relaci.
- Před každou operací posílá hardwarově orientovanou sekvenci se dvěma Ctrl+C,
  Enterem a Ctrl+B. V Simulator bridge Ctrl+C při `programRunning` pouze odešle
  požadavek `stop`.
- Worker stop přijme urgentně přes řídicí slot a naplánuje
  `mp_sched_keyboard_interrupt()`. První následný `sendCommand()` se pak provede
  jako `exec` přes `mp.runPython()`.
- Aktuální kontrakt nepotvrzuje volajícímu atomicky: program skončil, VM je
  `READY`, řídicí slot je prázdný a v MicroPython scheduleru nezůstal další
  interrupt.

Z toho plyne pracovní hypotéza: jeden z opakovaných Ctrl+C je doručen až po
ukončení programu a zůstane čekat do dalšího kooperativního `_poll()`, který
nastane uvnitř `fm_list()`. Hypotézu musí potvrdit integrační test s časovou
stopou; neopravovat ji jen přidáním další pevné prodlevy.

#### Implementovaný kontrakt opravy

Atomické `quiesceVm()` uvnitř stejného Workeru není spolehlivě realizovatelné:
synchronní `mp.runPython()` při nekoperativním programu blokuje message loop, a
Worker proto nemůže zpracovat ani `ping`, ani nové servisní RPC. Předchozí pokus
navíc `quiesce` odmítal jako `BUSY` a řídicí slot mazal dřív, než program skončil.

ESP IDE proto před každým nahráním a spuštěním programu vytvoří nový iframe,
Worker a `SharedArrayBuffer`, počká na nové `ready` a až potom nahraje zálohu,
assety a `/idecode`. Stejný čistý restart používá Stop, otevření Filemanageru a
návrat k targetu Simulator. Fyzické USB/BLE/WebREPL transporty si ponechávají
původní Ctrl+C sekvenci. Poslední publikovaný filesystem overlay se před výměnou
iframe uloží do IndexedDB; nová relace bridge má jiné session ID a ignoruje
opožděné odpovědi staré instance.

#### Povinné regresní scénáře

- `while True: print(...); sleep_ms(0)` -> otevřít Filemanager -> listing bez
  tracebacku a právě jedno zastavení programu;
- stejný test současně s OLED/I2C, servem a IRQ enkodéru;
- program neběží, skončí přirozeně právě při otevření nebo dostane Ctrl+C těsně
  před a těsně po požadavku;
- dvacet až sto cyklů otevřít/zavřít bez opožděného Ctrl+C;
- list/upload/download/mkdir/rename/copy/move/delete, včetně byte-exact `.raw`,
  `.mpy`, `.dat` a `.mfnt`;
- velký proud konzole a hranice 256KiB FM bufferu nesmějí kontaminovat rámce;
- timeout a restart Workeru musí zachovat publikovaný overlay;
- během maintenance relace se Start, REPL a Designer řídí zvoleným kontraktem;
- po zavření Filemanageru lze znovu spustit program a friendly/raw REPL zůstává
  živý.

### 4.8 Další známá slabá místa

- Kooperativní interrupt a hardware flush fungují jen v kódu, který dosáhne
  checkpointu (`sleep`, `Pin`, I2C apod.). Čistá nekonečná výpočetní smyčka bez
  checkpointu může stále vyžadovat tvrdý restart Workeru.
- `programRunning` v bridge slučuje běh programu a krátkou REPL operaci. Pro
  servisní relace je potřeba přesnější stav než jeden boolean.
- FM buffer má pevný limit 256 KiB. Chybí behaviorální test přetečení, obnovy
  synchronizace rámců a oddělení uživatelského stdout od protokolu.
- Persistentní overlay je publikován v definovaných checkpointech. Pád Workeru
  přesně mezi zápisem z Pythonu a publikováním může ztratit poslední změnu;
  kontrakt a UI varování nejsou zatím popsány.
- IRQ je kooperativní aproximace, ne cyklově přesná emulace ESP32. Je nutné
  testovat rychlé hrany, deaktivaci handleru a opakované starty programu.
- API `machine` není úplná kopie ESP32 portu. Chybí udržovaná capability matice
  proti aktuálnímu MicroPython ESP32 quickref; typicky budou potřeba další části
  Timer/WDT/UART/SPI a modely konkrétních periferií. `RTC` je host-clock
  aproximace bez alarmů a deep-sleep chování.
- `network.WLAN` pouze simuluje úspěšné připojení a neposuzuje SSID ani heslo.
  `ntptime` synchronizuje RTC s hodinami hostitele. `urequests` zatím podporuje
  jen GET, odpověď nejvýše 1 MiB a veřejné HTTP/HTTPS cíle přes proxy; nejde o
  obecný socketový stack.
- Browserové testy zatím nepokrývají skutečné časování Worker/iframe/IndexedDB.
  Regex kontroly a přímý headless WASM test závod z kapitoly 4.7 nezachytí.
- Výkon byl živě pozorován přibližně na 33 FPS ve složené OLED/servo/enkodér
  scéně, ale chybí opakovatelné měření CPU, paměti, latence vstupu a dlouhého běhu.
- COEP `credentialless` je nutný pro `SharedArrayBuffer`, ale může ovlivnit
  externí iframe závislé na cookies. Ověřit instalátor a doplňky před vydáním.
- Build ID je stále ručně opakované na více místech, takže hrozí směs starých a
  nových Worker modulů po částečné aktualizaci cache.




## 5. Výkon a ochrana proti zahlcení

### 5.1 Dávkování GPIO, PWM, NeoPixel a OLED

> **Stav 2026-08-21: opraveno včetně OLED.** Poslední stav GPIO/PWM/NeoPixel a
> OLED se publikuje nejvýše jednou za 16 ms. Přímý checkpoint z blokující WASM
> smyčky respektuje stejný limit; dokončení programu provede vynucený flush.
> SSD1306 drží pouze příznak změny a 1024B snapshot vytváří až při flushi,
> nikoli po každé I2C stránce.

Stdout má limit a dávkování, ale každý `pin_write`, `pwm_write` a
`neopixel_write` okamžitě volá `postMessage`. Rychlá smyčka může zaplavit
Worker, iframe i DOM, přestože konzole zůstane chráněná.

Zaveď coalescing posledních stavů:

```text
pending GPIO podle pinu
pending PWM podle pinu
pending NeoPixel podle pinu
       ↓ každých přibližně 16 ms
jedna dávka do UI
```

Přechody vstupního enkodéru a IRQ neslučuj stejným způsobem; tam je pořadí
hran významové. Výstupní stav LED/PWM může bezpečně používat poslední hodnotu.

Ve scéně ukládej příchozí stav do modelu a změny DOM prováděj v existujícím
`requestAnimationFrame`. LED a NeoPixel nyní mění styly přímo z message
handleru.

Kontrola musí používat falešné hodiny a spočítat počet odeslaných dávek.
Tisíce zápisů během jednoho snímku mají vést k jedné konečné hodnotě na pin.

### 5.2 Lifecycle skrytého simulátoru

> **Stav 2026-08-21: opraveno včetně návratu na target Simulator.** Controller a
> scéna mají suspend/resume a destroy cestu, animační smyčka se při deaktivaci
> zastaví, pending RPC se při zániku odmítnou a opětovná aktivace existujícího
> iframe provede skutečný `resume` handshake. Chrome test třikrát zopakoval
> `Simulator → ESP32 → Simulator`; po každém návratu šel enkodér ovládat a
> přidal právě jeden krok. Zůstává automatický test ztráty iframe/Workeru.

Přepnutí na jiný target skryje panel a pošle `suspend`. Iframe, Worker a
filesystem overlay zůstávají živé. Při návratu se nejdříve obnoví stejný iframe
přes RPC `resume`; pokud neodpoví, bridge vytvoří nový ready handshake s
cache-busted URL, bez továrního resetu filesystému.

Přidej lehký lifecycle:

- `suspend()` zastaví animační smyčku a program,
- `resume()` obnoví scénu bez ztráty filesystemu,
- `destroy()` ukončí Worker, listenery, timery a pending RPC.

Není nutné iframe při každém zavření panelu ničit. Rozlišuj pouhé schování
panelu od deaktivace targetu Simulator.

## 6. Konfigurace scény musí být skutečným zdrojem pravdy

### 6.1 Původní rozpory

> **Stav 2026-08-21: hlavní rozpory opraveny.** Canvas má 520 px, konfigurace se
> validuje před vytvořením scény a sdílení GPIO 19/20 motorů je explicitní.
> Následující text popisuje původní důvod změny; otevřená zůstává otázka
> duplicitních metadat komponent v kapitole 6.3.

Současný `config/default.json` uvádí canvas široký 400 px, zatímco CSS pro
`.lite-scene` vynucuje `min-width: 1200px`. CSS tím přebíjí konfiguraci.

Podle deklarovaných 400 px jsou nyní mimo plochu:

- `adc-1`, jehož pravý okraj je na 510 px,
- `encoder-1`, jehož pravý okraj je na 455 px.

`motor-1` a `motor-2` sdílejí piny 19 a 20. Může to být úmyslné paralelní
zapojení, ale konfigurace to nijak neoznačuje.

### 6.2 Požadovaný validátor

Přidej malý čistý modul, například `core/config.js`, který načtenou konfiguraci
normalizuje a validuje ještě před vytvořením `Scene`.

Kontroluj minimálně:

- podporovanou `schemaVersion`,
- rozměry canvasu,
- unikátní a neprázdné ID,
- registrovaný typ komponenty,
- povinné vlastnosti a connection role podle typu,
- celé GPIO v podporovaném rozsahu,
- kladnou velikost a polohu uvnitř canvasu,
- konflikt pinů,
- explicitní povolení sdíleného pinu,
- existenci požadovaných bitmap,
- režim serva pouze `180` nebo `360`,
- bezpečný počet NeoPixelů.

Chybová zpráva musí obsahovat ID komponenty a přesnou vlastnost. Neopravuj
potichu závažnou chybu na defaultní hodnotu.

Odstraň pevnou `min-width: 1200px`; velikost scény má pocházet z JSON. Host
může plochu posouvat nebo později škálovat, nesmí však přepsat její logické
rozměry.

### 6.3 Jediný zdroj metadat komponenty

Soubory `assets/components/*/component.json` se nyní nepoužívají a duplikují
`maxRpm`, `stepAngle`, vrstvy a další hodnoty z `default.json` a JS.

Vyber jednu z možností:

1. Pro nejkompaktnější řešení je odstraň a zdokumentuj konvenci
   `body.png` + `moving.png` v registru komponent.
2. Pokud mají být znovupoužitelným katalogem, skutečně je načítej a nech v
   `default.json` pouze instanční override.

Nenechávej dva nepropojené zdroje pravdy. Konstantu `FOLDERS` v `scene.js`
buď začni používat v registru, nebo ji odstraň jako mrtvý kód.

## 7. Komponentová architektura

> **Stav 2026-08-21: registr factory funkcí je zaveden a OLED jej používá.**
> Další dělení prováděj jen u komponent s vlastním protokolem nebo významným
> stavem; není potřeba obecný framework.

`Scene` je stále srozumitelná, ale každý nový typ přidává další `if` a další
metodu do jednoho souboru. Před OLED zaveď jednoduchý registr bez frameworku:

```js
registerComponent('led', createLedComponent);
registerComponent('servo', createServoComponent);
registerComponent('dc-motor', createMotorComponent);
registerComponent('oled-ssd1306', createOledComponent);
```

Doporučený kontrakt instance:

```js
{
  definition,
  pins,
  initialise(),
  applySignal(event),
  tick(elapsedMs),
  setLabels(labels),
  destroy()
}
```

Nevytvářej ihned jeden soubor pro každou jednoduchou LED. Rozděl samostatně
jen modely, které mají vlastní protokol nebo významný stav:

- rotační enkodér,
- DC motor / H-můstek,
- servo,
- OLED framebuffer,
- budoucí socket endpoint.

U těchto komponent odděl čistý model od DOM rendereru. Čistý model lze testovat
v Node bez prohlížeče.

### 7.1 Rotace bez glitche přes 360 stupňů

Aktuální neomezený úhel zabraňuje přechodu CSS z 359° zpět na 0° opačným
směrem. Při velmi dlouhém běhu ale může narůstat do velkých hodnot.

Zachovej souvislý logický úhel. Pokud bude potřeba rebase, proveď jej pouze
způsobem, který zachová stejnou transformační matici a nevytvoří CSS transition
přes opačný směr. Přidej testy alespoň pro:

- 359° -> 361°,
- záporný průchod přes 0°,
- několik tisíc otáček,
- změnu směru motoru.

### 7.2 H-můstek

Explicitně zdokumentuj konvenci směru:

- IN1 PWM, IN2 LOW,
- IN1 LOW, IN2 PWM,
- oba LOW,
- oba HIGH,
- rozdílné PWM na obou vstupech.

Současný vzorec používá rozdíl druhého a prvního vstupu. Test musí potvrdit,
že znaménko odpovídá generovanému kódu ESP IDE a obrázku motoru. Neotáčej směr
jen podle dojmu z grafiky.

## 8. Virtuální sběrnice a další periferie

### 8.1 I2C registry jako základ OLED a senzorů

> **Stav 2026-08-21: základ a SSD1306 128×64 implementovány.** `machine.I2C`
> pouze předává operace do `core/i2c.js`; registry směruje zařízení podle
> sběrnice a adresy. SSD1306 interpretuje command/data prefixy z distribuovaného
> `oled.py`, drží 1024b `MONO_VLSB` framebuffer a Worker odesílá nejvýše jeden
> poslední snímek za 16ms dávku. Výchozí zařízení odpovídá na `0x3C` přes
> SoftI2C SCL22/SDA21 i I2C(0). Vzhled, motiv i živý framebuffer byly ověřeny
> v browseru.

Neimplementuj OLED přímo v `machine.py` ani pomocí speciální podmínky v
`Scene`. Zaveď ve Workeru registry zařízení podle sběrnice a adresy:

```text
I2CBus(id/scl/sda)
  ├─ 0x3C -> SSD1306 device model
  ├─ 0x20 -> PCF8574 device model
  └─ 0x29 -> budoucí senzor
```

`machine.I2C` pouze předává standardní operace do sběrnice. Registry rozhodne,
které zařízení odpoví. Postupně doplň:

- `scan`,
- `writeto`,
- `readfrom`,
- `writeto_mem`,
- `readfrom_mem`,
- jejich `_into` varianty, pokud je používají distribuované knihovny.

SSD1306 model má interpretovat řídicí a datové bajty, udržovat 128×64
framebuffer a do UI posílat dávkovaný snímek. Orientaci framebufferu ověř proti
reálné knihovně; nepředpokládej automaticky formát bez kontroly jejího kódu.

### 8.2 Sockety

Sockety řeš pomocí explicitních virtuálních endpointů:

```text
socket API v MicroPythonu
  -> message do Worker host vrstvy
  -> registrovaný lokální endpoint
  -> deterministická odpověď
```

Ve výchozím stavu nepovoluj libovolná TCP spojení z Workeru. Reálná síť by
vyžadovala bezpečnostní pravidla, CORS/WebSocket proxy a jasný souhlas hostitele.
Pro výuku jsou vhodnější předvídatelné lokální endpointy a scénáře.

### 8.3 Capability mapa a toolbox

`toolbox_Simulator.xml` je k 2026-08-21 přesnou kopií
`toolbox_ESP32S3.xml`: 230 bloků a 20 kategorií. To je správný výchozí bod, ale
velká část bloků zatím nemá odpovídající simulaci.

Přidej deklarativní capability mapu, například:

```json
{
  "gpio": true,
  "pwm": true,
  "adc": true,
  "irq": "cooperative",
  "neopixel": true,
  "i2c": "registry",
  "oled_ssd1306": true,
  "sockets": false,
  "filesystem": "persistent-overlay",
  "raw_repl": true
}
```

Capability mapa má sloužit dokumentaci, testům a případně sestavení toolboxu.
Nedoplňuj podmínky pro Simulator do všech částí ESP IDE. Samostatný toolbox
zachovej jako jasnou hranici.

Při aktivaci nové schopnosti vždy zkontroluj celý řetězec:

```text
Blockly blok -> generovaný MicroPython -> distribuovaná knihovna
-> machine/bus shim -> Worker event -> model komponenty -> renderer
```

## 9. REPL a transportní kontrakty

### 9.1 Raw REPL

> **Stav 2026-08-21: skutečný raw REPL je implementován a headless ověřen.**
> Display Designer používá přímý framebuffer RPC. Filemanager stále používá
> REPL protokol a jeho otevření po běžícím programu má P0 chybu z kapitoly 4.7.
> Následující odstavec popisuje původní stav.

`ide-bridge.js` při `enterRawREPL()` jen nastaví boolean a
`execRawCommand()` přesměruje na běžný `sendCommand()`. To není skutečný raw
REPL kontrakt.

ESP IDE používá raw metody v některých souborových a Display Designer
operacích. Vyber jednu čistou cestu:

- implementovat raw REPL kompatibilně včetně odpovědí, nebo
- pro Simulator používat přímo strukturované RPC (`exec`, `readFile`,
  `writeFile`, `mkdir`, `delete`, `stat`) a capability mapou oznámit, že raw
  transport není potřeba.

Druhá varianta je pro Simulator pravděpodobně menší a spolehlivější. Nesmí ale
lhát metodami, které vypadají kompatibilně a chovají se jinak.

### 9.2 Friendly REPL

Zachovej:

- banner a prompt `>>>`,
- echo znaků,
- správné CR/LF,
- prázdný primární řádek bez `SyntaxError`,
- pokračovací prompt `...`,
- okamžitý Ctrl+C mimo běžnou frontu,
- omezený a dávkovaný stdout/stderr.

Stav `programRunning` dnes zahrnuje přímý `run_code()` i běh příkazu z REPL.
Po zavedení stavového automatu nepoužívej několik volných booleanů, které se
mohou přepisovat událostmi `repl-running` a `repl-done` v nevhodném pořadí.

### 9.3 Protokol mezi hostitelem a iframe

> **Stav 2026-08-21: základ opraven.** Událost `ready` nese verzi protokolu,
> runtime verzi a capabilities; hostitel kontroluje kompatibilitu. Nový
> maintenance stav Filemanageru musí tento kontrakt rozšířit explicitně, ne
> dalším nezdokumentovaným booleanem.

Přidej malou verzi protokolu a capabilities do události `ready`, například:

```js
{
  protocolVersion: 1,
  runtimeVersion: '1.28.0-6',
  capabilities: { ... }
}
```

Hostitel pak může odmítnout nekompatibilní iframe s čitelnou chybou místo
náhodného timeoutu.

## 10. Rozdělení kódu bez zbytečného rozdrobení

`embed.js` nyní obsahuje UI shell i headless řízení Workeru. Doporučený jediný
větší řez:

```text
core/controller.js       Worker lifecycle, stav, RPC, files, GPIO/ADC
standalone-shell.js      editor, lokální konzole a tlačítka standalone režimu
embed.js                 malé veřejné mount API, které spojí Controller a Scene
```

`worker.js` rozděl až současně se zavedením fronty, nejvýše na:

```text
worker.js                 bootstrap a router
runtime/vm-session.js     stav VM, fronta, REPL a běh programu
runtime/hardware-bridge.js signály, batching a virtuální sběrnice
```

Nevytvářej obecný dependency-injection framework, event-sourcing ani strom
mikromodulů. Každý nový soubor musí mít jednu zřetelnou odpovědnost a vlastní
testovatelný kontrakt.

## 11. Duplicitní údaje a verzování

### 11.1 Verze assetů

`ide-bridge.js` dostává jediný token z `APP_VERSION` ESP IDE a předává jej do
iframe, `app.js`, `embed.js`, Workeru a jejich vlastních modulů. Samostatná
stránka používá Apache `Cache-Control: no-cache, must-revalidate` pro měnitelné
zdroje. V názvech jednotlivých JavaScriptů už není ručně opakované build ID.
Řešení zůstává bez bundleru; runtime hashování `files.lst` k tomu není potřeba.

Při změně assetu načítaného ESP IDE vždy zkontroluj:

- URL dynamického `ide-bridge.js`,
- URL iframe,
- importy `app.js`, `embed.js`, `worker.js`, `scene.js` a `styles.js`,
- `APP_VERSION` a pravidla Service Workeru ESP IDE.

Simulator zatím není součástí offline precache. Neměň to mimo samostatný úkol,
protože WASM a distribuční filesystem výrazně zvětšují cache.

### 11.2 Překlady

Výchozí popisky jsou duplikované v `DEFAULT_LABELS` a `HOST_LABELS`. Vložený
scene-only režim navíc nepotřebuje překlady vlastního editoru a konzole.

Udržuj jeden seznam názvů klíčů a odděl:

- popisky komponent sdílené scénou,
- standalone ovládání,
- panel hostitele ESP IDE.

Při změně i18n vždy zachovej CZ/EN/DE paritu a spusť:

```powershell
node .github/scripts/validate-i18n.mjs
```

### 11.3 Vendored MicroPython

`vendor/README.md` nyní obsahuje jen název balíčku. Doplň dokumentaci původu:

- přesný název a verzi npm/upstream balíčku,
- upstream URL nebo commit/tag,
- datum převzetí,
- build variantu PyScript,
- licenci,
- SHA-256 vendored `micropython.mjs` a `micropython.wasm` pro kontrolu repozitáře.

Tento hash je kontrola vendored runtime, nikoliv návrat hashovacího katalogu
uživatelského filesystemu.

Vendored soubory ručně neupravuj. Upgrade musí být samostatná změna s
headless runtime testy.

## 12. Automatické testy požadované před rozšiřováním

Současný `tests/logic.test.mjs` ověřuje několik výpočtů a velkou část runtime
požadavků pouze hledáním textu regulárním výrazem. Přítomnost slova
`repl-running` není důkaz správného pořadí událostí.

Přidej následující čistě automatické testy bez prohlížeče.

### 12.1 Konfigurace

- validní výchozí konfigurace,
- duplicitní ID,
- neznámý typ,
- komponenta mimo canvas,
- neplatný pin,
- konflikt a explicitně povolené sdílení pinů,
- chybějící bitmapa,
- neplatný režim serva.

### 12.2 Modely komponent

- servo 180° pro minimální, střední a maximální puls,
- servo 360° v obou směrech a stop pásmo,
- průchod rotace přes 360° bez obráceného kroku,
- H-můstek ve všech čtyřech stavech,
- enkodér a tlačítko,
- NeoPixel RGB a případně RGBW.

### 12.3 RPC a Worker lifecycle

- serializace VM příkazů,
- urgentní interrupt,
- timeout,
- restart s pending požadavkem,
- Worker error,
- destroy,
- pozdní odpověď,
- opětovný start po chybě inicializace.

### 12.4 Filesystem

- přesné parsování současného `files.lst`,
- binární round-trip,
- overlay po resetu,
- override `boot.py` a `main.py`,
- tovární reset,
- cesty, podadresáře a prázdné soubory.

### 12.5 Headless MicroPython WASM

Připrav Node testovací harness používající vendored `micropython.mjs` přímo,
bez DOM a bez prohlížeče. Ověř:

- inicializaci runtime,
- instalaci `/lib/machine.py`,
- pořadí `boot.py` -> `main.py`,
- `import utime`,
- `sleep_ms(0)`,
- `Pin`, PWM, ADC a IRQ,
- `run_code()`,
- přerušení a následnou životaschopnost interpretu,
- banner, echo, CR/LF a prompty REPL.

Pokud část vyžaduje skutečný Worker, použij Node Worker nebo malý falešný
endpoint. Nedělej z textového regex testu náhradu behaviorálního testu.

## 13. Povinné statické kontroly po změně

Podle rozsahu spusť alespoň:

```powershell
node --check simulator_lite/app.js
node --check simulator_lite/embed.js
node --check simulator_lite/frame-bridge.js
node --check simulator_lite/ide-bridge.js
node --check simulator_lite/worker.js
node --check simulator_lite/core/scene.js
node simulator_lite/tests/logic.test.mjs
node .github/scripts/validate-i18n.mjs
powershell -ExecutionPolicy Bypass -File esp_ide_v2/tools/test-local-ai.ps1
git -c core.whitespace=cr-at-eol diff --check
```

Pro Python shim použij kontrolu bez vytváření `__pycache__`, například:

```powershell
python -B -c "from pathlib import Path; p=Path('simulator_lite/runtime/machine.py'); compile(p.read_text(encoding='utf-8'), str(p), 'exec')"
```

Po každé změně zkontroluj také `git status --short`, aby se do výsledku
nedostaly vendor soubory, cache, screenshoty nebo nesouvisející změny.

Prohlížečové testy a fyzické zařízení v této fázi ponech uživateli, pokud
výslovně nepožádá jinak. V závěrečném reportu je označ jako neprovedené.

## 14. Doporučené pořadí implementace

Původní fáze A až D jsou převážně dokončené. Z fáze E je hotový I2C základ a
SSD1306/OLED. Další práce má pokračovat podle skutečného rizika, ne podle počtu
nových komponent:

### Fáze F – P0 oprava servisní relace (provedeno)

1. Simulator má oddělenou restartovací cestu před uploadem, Stopem a FM.
2. Každá generace iframe používá vlastní session ID.
3. Fyzické transporty si ponechaly svou sériovou Ctrl+C sekvenci.
4. Automatické testy kontrolují pořadí restart → upload a živý Chrome test
   pokrývá opakovaný běh, Stop, Filemanager, reload a přepnutí targetu.

### Fáze G – kompatibilita a odolnost

1. Vytvořit capability matici proti MicroPython ESP32 quickref: přesný import,
   signatury, konstanty, návratové hodnoty, výjimky a stav simulace/testu.
2. Nejprve uzavřít nejpoužívanější `machine.Pin`, IRQ, PWM, ADC, I2C a SPI
   odchylky; každou změnu ověřit malým kompatibilitním programem.
3. Přidat stresové testy opakovaných startů, konzole, velkých binárních souborů,
   IRQ a persistentního overlaye.
4. Zavést opakovatelné měření CPU, paměti, FPS a vstupní latence.
5. Sjednotit build ID a otestovat aktualizaci cache i ztrátu Workeru/iframe.

### Fáze H – nové periferie

1. Vybrat zařízení podle skutečně používaných distribuovaných knihoven.
2. Přidávat je přes existující registry sběrnic a komponent, vždy s modelem,
   capability záznamem a behaviorálním testem.
3. Sockety povolit pouze přes explicitní bezpečné endpointy.
4. Toolbox průběžně označovat podle capability mapy, aby nesliboval nepodporované
   API bez viditelného omezení.

Nepokračuj fází H, dokud není uzavřena chyba Filemanageru a neexistuje integrační
test, který ji umí před opravou reprodukovat a po opravě zachytit regresi.

## 15. Akceptační kritéria architektury

Další etapa je připravena pouze tehdy, když platí:

- ESP IDE stále integruje Simulator jediným odděleným bridge modulem.
- Standalone a iframe používají stejný runtime controller.
- Žádné dvě operace nevstupují souběžně do MicroPython VM.
- Ctrl+C zůstává urgentní a není blokované běžnou frontou.
- Každý RPC request skončí odpovědí, timeoutem nebo explicitním zrušením.
- Reset zachová uživatelský filesystem; tovární reset jej vymaže vědomě.
- Opakované spuštění programu nehromadí Pin/IRQ/Timer objekty.
- Rychlé GPIO/PWM smyčky nevytvářejí neomezený počet UI zpráv.
- Konfigurace je validovaná a je jediným zdrojem rozměrů a zapojení.
- Nová komponenta nevyžaduje úpravu dlouhého řetězce `if` v `Scene`.
- Toolbox, generovaný Python, capabilities a simulované API se nerozcházejí
  bez zdokumentovaného omezení.
- Statické a headless testy projdou; prohlížečové a fyzické testy jsou v
  reportu pravdivě označeny podle skutečného provedení.

## 16. Co nyní nepředělávat

- Nevracej profilový editor, ZIP balíčky ani runtime hashování z původního
  simulátoru.
- Nezačínej emulovat instrukční sadu ESP32.
- Nespojuj Worker přímo s interními globálními proměnnými ESP IDE.
- Nevkládej renderer komponent do `machine.py`.
- Nevkládej I2C logiku konkrétního OLED přímo do obecného bridge.
- Nezaváděj libovolný přístup k internetu jako „socket simulaci“.
- Neupravuj vendored WASM ručně.
- Nepřidávej simulátor do PWA precache bez samostatného návrhu velikosti,
  aktualizací a offline chování.
- Nedělej velký refaktor pouze kvůli názvům nebo stylu. Každá změna musí
  odstraňovat konkrétní riziko nebo připravovat konkrétní periferii.

## 17. Doporučený první úkol pro další AI

Další práce má rozšířit živou regresní matici bez návratu k RPC `quiesce`:

1. opakovat restartovací test také s nekoperativní smyčkou bez `_poll()`;
2. pokrýt zápis binárního souboru, přesun, přejmenování a smazání ve Filemanageru;
3. ověřit, že poslední publikovaný overlay přežije target switch a že reload
   horní stránky naopak obnoví tovární `boot.py`, `main.py` a knihovny;
4. spustit `npm.cmd test` a živý Chrome test bez nových chyb konzole.

Do tohoto patche nepřidávej periferie ani obecný refaktor Workeru. Pokud je pro
správný kontrakt nutné změnit veřejné rozhraní ESP IDE transportu, nejprve
zmapuj všechny jeho implementace a zachovej chování fyzických zařízení.

Po opravě pokračuj úplnou živou kontrolou Filemanageru, restartu a továrního
resetu. Teprve potom má výkonnější AI převzít capability matici MicroPython API
a další periferní modely. Praktické obtíže, které je potřeba zachovat v paměti:

- `/dev` nelze odstranit bez poškození stdout/REPL; pouze se skrývá. Ostatní
  tři Emscripten adresáře bylo možné bezpečně odstranit ještě před distribucí;
- fyzický sériový transport potřebuje obrannou Ctrl+C sekvenci, Simulator před
  servisní operací vytváří novou runtime relaci; neslučovat jejich kontrakt;
- browserové timery se během synchronně běžícího WASM kódu neuplatní tak jako
  běžná asynchronní smyčka, proto jsou kooperativní checkpointy součástí
  architektury, ne pouze výkonová optimalizace;
- plný Filemanager UI workflow zůstává neověřený. Runtime listing a filtrace jsou
  otestované, ale upload/download/move/delete a chybové cesty je nutné projít po
  opravě P0.
