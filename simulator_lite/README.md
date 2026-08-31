# ESP IDE Simulator Lite

Malé, samostatné jádro simulátoru pro target `Simulator` v ESP IDE.

Tento adresář záměrně neobsahuje profilový editor, ZIP balíčky, hashovací
vrstvu ani obecnou podporu více procesorů. Scéna je obyčejný JSON soubor a
distribuční filesystém se načítá přímo z `simulator_lite/filesystem/files.lst`.

## Spuštění

Přes Apache:

```text
http://127.0.0.1/simulator_lite/
```

Přímé `file://` otevření není podporováno, protože Worker načítá WASM a
virtuální filesystém přes HTTP. Apache posílá COOP/COEP hlavičky z `.htaccess`;
standalone režim i nadřazené `esp_ide_v2/.htaccess` proto zpřístupní
`SharedArrayBuffer` pro okamžité přerušení a živé GPIO/IRQ vstupy.

## Vrstvy

```text
embed.js                 veřejné mount API pro standalone i hostitelský panel
frame-bridge.js          postMessage API uvnitř izolovaného iframe
ide-bridge.js            volitelný adaptér pro ESP IDE (iframe + REPL/files)
scene.js                 DOM renderer a uživatelské vstupy
worker.js                MicroPython WASM, soubory a HW most
runtime/machine.py       kompatibilní Pin/PWM/ADC/IRQ/I2C/SPI/RTC
runtime/network.py       virtuálně připojené WLAN rozhraní
runtime/urequests.py     HTTP GET přes browser fetch bridge
runtime/dht.py           DHT11/DHT22 nad hodnotami komponenty scény
runtime/fs-loader.js     přímé načtení files.lst bez hashů
runtime/fs-overlay.js    binární overlay, tombstones a snapshot MEMFS
core/fs-store.js         persistence overlaye do IndexedDB
core/i2c.js              registry sběrnic a model SSD1306 128×64
config/default.json      poloha komponent, piny a jejich vlastnosti
assets/components/       bitmapové vrstvy body/moving
```

Worker používá 64 pevných slotů pro digitální GPIO, 64 pro ADC, 64 pro teplotu
DHT, 64 pro vlhkost DHT a jeden řídicí slot pro Ctrl+C. V izolovaném standalone režimu se vstupy mění přes
`SharedArrayBuffer`, takže `while True` ani `time.sleep*()` nezamknou UI. Sleep
je rozdělen na kvanta nejvýše 5 ms, ve kterých se kontrolují IRQ a přerušení.
I `sleep_ms(0)` trvá nejméně 5 ms. Smyčka tak nemůže běžet rychleji než zhruba
200 průchodů za sekundu a nevytíží Worker čistým busy-loopem.
Interaktivní REPL používá byte-preserving WASM stream a po startu explicitně
volá `mp.replInit()`, takže je vidět banner, echo, backspace, CR/LF i prompt
`>>>`. Vstupy se ve Workeru zpracovávají sériově, aby Enter nemohl předběhnout
echo příkazu. Výstup se sbírá do omezených dávek; při zahlcení se staré znaky
zahodí s viditelným upozorněním, takže se nezahltí `postMessage`, DOM ani xterm
při nekonečném tisku. Kooperativní checkpoint v `sleep_ms(0)` současně uvolní
Worker pro přerušení a flush konzole i čekajících GPIO/PWM/OLED událostí.
Výstupní události a OLED se do UI publikují nejvýše jednou za 16 ms; mezilehlé
stavy se sloučí na poslední hodnotu. Virtuální I2C navíc respektuje nastavenou
frekvenci sběrnice, takže přenos 128×64 framebufferu při 400 kHz přirozeně
zabere přibližně 20–25 ms místo okamžitého přenosu stovkykrát za sekundu.
Virtuální `machine.Pin` podporuje vstup, výstup, open-drain, pull-up/pull-down,
obě hrany i úrovňové IRQ a obvyklé `mode/pull/drive/hold` nastavení.
`disable_irq()` a `enable_irq()` dočasně pozastaví a obnoví kooperativní
vyvolávání GPIO handlerů; stav Ctrl+C tím není blokován.
Prázdný Enter na primárním promptu se obslouží jako nový prompt bez
`SyntaxError`; prázdný řádek uvnitř víceřádkového bloku se stále předá
MicroPythonu, aby blok korektně ukončil.
V panelu ESP IDE se do simulátoru předávají stejné CSS proměnné a překlady jako
v hostiteli; standalone režim používá vlastní světlé/tmavé výchozí hodnoty.
V neizolovaném hostiteli je připravená bezpečná `ArrayBuffer` záloha pro běžné
operace. Vstupní hrany ale během blokující nekonečné MicroPython smyčky
vyžadují `SharedArrayBuffer`, protože Worker tehdy nemůže přijmout další
`postMessage`; proto musí být izolovaný i horní dokument ESP IDE, ne jen iframe.
Stop v neizolované záloze v krajním případě restartuje Worker.

Vendored Emscripten build obsahuje pouze MEMFS, nikoli IDBFS. Simulator proto
po načtení distribučního základu aplikuje binární uživatelský overlay z
IndexedDB ještě před `boot.py` a `main.py`. Změny vytvořené přes strukturované
`write-file` RPC i Python `open()` se snapshotují po dokončení VM operace a při
kooperativních poll bodech. Při prvním výběru targetu `Simulator` po novém
načtení stránky ESP IDE se overlay jednou smaže, takže `boot.py`, `main.py` a
knihovny začnou z distribučního stavu. Uvnitř stejné relace stránky se overlay
zachovává mezi běhy, restartem Workeru i přepnutím targetu.
`factoryResetFilesystem()` umí stejný reset vyvolat ručně a restartuje runtime
s původními soubory z `filesystem/`. V ESP IDE je tato operace dostupná jako
potvrzovaná položka `Tovární reset FS` v nabídce panelu. Napojení stávajícího
Filemanageru používá stejný oddělený 256KiB přijímací buffer jako sériový
transport. Emscripten adresáře `/home`, `/proc` a `/tmp` se před načtením
distribuce odstraní. Interní `/dev` zůstává kvůli TTY/REPL, ale uživatelský
listing Workeru i Filemanageru jej skrývá.

Před každým spuštěním programu z ESP IDE se vytvoří nový iframe, Worker a
`SharedArrayBuffer`, počká se na nové `ready` a teprve potom se nahrají projektové
soubory. Staré a nové RPC rámce jsou oddělené session ID, takže opožděná odpověď
z ukončeného runtime nemůže dokončit požadavek nové instance. Všechny vlastní
moduly odvozují cache token z jediného `APP_VERSION` hostitelského ESP IDE;
standalone Apache navíc vyžaduje revalidaci měnitelných zdrojů. V názvech
jednotlivých JavaScriptů se proto ručně neopakuje build verze.

ESP IDE adaptér posílá Ctrl+A/Ctrl+B a raw příkazy do skutečného znakového
REPL procesoru ve WASM; `enterRawREPL()`, `execRawCommand()` a
`exitRawREPL()` tedy používají reálné `OK + stdout + EOT + stderr + EOT`
rámce. Protokol a binární zápis jsou ověřené headless WASM testem. Úplné UI
Filemanageru stále vyžaduje ruční browserový test.

Výchozí scéna obsahuje OLED 128×64 na SDA21/SCL22, adrese `0x3C`. Stejný model
je dostupný přes `SoftI2C` i `I2C(0)`. `machine.I2C` podporuje `scan`,
`writeto`/`writevto`, `readfrom`, paměťové operace a `_into` varianty; směrování
zajišťuje registry v `core/i2c.js`. Distribuovaný `oled.py` byl v headless WASM
testu použit k vykreslení pixelů `(0, 0)` a `(127, 63)`, čímž se kontroluje i
orientace `MONO_VLSB` framebufferu.
OLED je složený z bitmapy modulu a samostatného konfigurovaného obdélníku pro
dynamický canvas. Display Designer při targetu Simulator posílá bitmapu přímo
do virtuálního OLED; fyzické transporty nadále používají framebuffer a
`display.show()`. Vzhled karty a popisku přebírá
světlé/tmavé schéma hostitele.

Plocha scény je ve výchozí konfiguraci průhledná. `canvas.backgroundColor`
může obsahovat libovolnou CSS barvu, CSS proměnnou nebo hodnotu `transparent`;
pokud položka chybí, použije se také průhlednost. Volitelná bitmapa se zadává
bezpečnou relativní cestou od `assets/components/`:

```json
"canvas": {
  "width": 520,
  "height": 600,
  "backgroundColor": "transparent",
  "backgroundImage": "backgrounds/laborator.webp",
  "backgroundSize": "contain"
}
```

`backgroundSize` podporuje `auto`, `contain` a `cover` (výchozí). Obrázek se
vystředí a neopakuje. Všechny karty komponent používají společný povrch
`--sim-component-bg`, který standardně odkazuje na barvu tématu
`--ui-bg-elevated`.

Enkodér podporuje tlačítka, kolečko i kruhové tažení myší. Výchozí interakce
vždy vytvoří právě jeden detent na kliknutí nebo krok ovládání. Pouze animace
a čtyři elektrické A/B přechody jednoho detentu běží třikrát rychleji, aby
kolečko svižně následovalo myš a IRQ události se nehromadily ve frontě. Stavové
štítky zobrazují kroky a úhel enkodéru, úhel nebo rychlost serva a procenta i
otáčky DC motorů. Režim serva lze na jeho kartě za běhu přepnout mezi 180° a
360°; kliknutím na LED lze změnit její zobrazovanou barvu. NeoPixel používá
bitmapový podklad a osm explicitních středů LED z `config/default.json`, takže
barevné body odpovídají skutečným pozicím na modulu.

Vložený režim (`?embed=1`) záměrně vykresluje pouze plochu se simulovanými
prvky. Editor, konzole, REPL a tlačítka Start/Stop zůstávají v ESP IDE a
transport do nich přeposílá stejný výstup jako připojené zařízení. Pokud kód
spuštěný přímo z friendly REPL zablokuje v `while True`, Worker oznámí stav
`repl-running`; Ctrl+C pak použije interrupt slot okamžitě a nezůstane za
dlouhou operací ve frontě znaků.

Hostitelský panel je ve výchozím stavu ukotvený jako měnitelný pravý sloupec,
takže nezakrývá záložky textového editoru ani terminál. Lze jej skrýt nebo
odpojit do přesouvatelného okna uvnitř IDE; při úzkém viewportu využije plochu
editoru a ponechá viditelný terminál. Panel i iframe přebírají světlé/tmavé
CSS proměnné hostitele. Při minimalizaci a opětovném otevření si ukotvený panel
uchová poslední scroll pozici scény v `localStorage`.

`ADC.read_uv()` převádí celý rozsah `read_u16()` na 0 až 3 300 000 µV.
Virtuální `network.WLAN` se po `connect()` ihned označí jako připojené a vrací
testovací konfiguraci sítě. `RTC` běží podle hodin hostitelského počítače a
`ntptime.settime()` jej s nimi znovu synchronizuje. `urequests.get()` předá GET
požadavek přes `fetch`; cizí originy používají `http-proxy.php`, který omezuje
protokol, porty, privátní adresy, čas i velikost odpovědi.

Výchozí scéna obsahuje analogový joystick na X=GPIO13, Y=GPIO14 a SW=GPIO15.
Knoflík používá Pointer Events, takže funguje myší i dotykem, po puštění se vrátí
do středu a tlačítko je aktivní v nule. Vizuální výchylka hlavice je omezená,
ale ADC osy nadále využívají celý rozsah 0 až 65535; stavový štítek jej ukazuje
jako 0 až 100 %. DHT22 na GPIO9 má přímo
v komponentě vícejazyčně popsané posuvníky teploty a relativní vlhkosti;
hodnoty čte standardní `dht.DHT22`.

Stav serva 360° a DC motorů se zobrazuje pouze v procentech `-100 %` až
`100 %`; otáčky zůstávají jen interním parametrem animace. Při spuštění zelenou
šipkou adaptér zapíše do terminálu `run_code()`, než požadavek předá Workeru.
Výchozí piny hardwarových bloků v `toolbox_Simulator.xml` odpovídají první
komponentě daného typu v `config/default.json`.

## Přidání komponenty

1. Přidat typ do `core/scene.js`.
2. Přidat jeho konfiguraci do `config/default.json`.
3. Pokud používá grafiku, přidat `assets/components/<typ>/body.png` a
   `moving.png` nebo CSS vykreslení.
4. Přidat malý test do `tests/logic.test.mjs`.

Model komponenty zná pouze signály a stav. DOM řeší pouze `Scene`; stejný model
je proto použitelný ve standalone stránce i v ukotveném panelu ESP IDE.

## Omezení první etapy

- Není to emulace instrukční sady ESP32, elektrického časování ani proudů.
- Sockety nejsou skutečné TCP. `urequests` podporuje pouze GET s odpovědí do
  1 MiB přes bezpečně omezený HTTP proxy endpoint; libovolné TCP by vyžadovalo
  samostatný WebSocket proxy server.
- Čistá vytížená smyčka bez `sleep`, čtení GPIO/ADC nebo jiného kontrolního bodu
  zůstává nekooperativně nepřerušitelná; Stop má nouzový Worker restart. Takové
  tvrdé ukončení může ztratit poslední dosud nesnapshotované zápisy z Pythonu.
- Target `Simulator` v `esp_ide_v2` načítá kopii toolboxu z tohoto adresáře a
  používá `ide-bridge.js`. Adaptér obsluhuje run/stop, virtuální REPL, zápis a
  čtení souborů i konzolové události; fyzické USB/BLE/WebREPL drivery zůstávají
  mimo tento kód.
- Offline precache simulátoru zatím není součástí ESP IDE cache; standalone
  stránka se načítá z `/simulator_lite/` přes Apache.
