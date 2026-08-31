# Plán vývoje ESP IDE Simulator Lite

## Rozhodnutí

Pokračujeme v novém `simulator_lite/`, ne v původním `simulator/`. Původní
simulátor zůstává referenčním zdrojem ověřených částí, ale jeho profilový
systém, hashované balíčky a více-board vrstvy se do Lite nepřenášejí.

Základní pravidla:

- `config/default.json` je jediný zdroj poloh, pinů a vlastností scény.
- `instalace_new/esp32_s3/files.lst` se načítá přímo, bez hashování a bez
  kopírovaného seznamu knihoven.
- MicroPython běží výhradně ve Workeru; UI komunikuje událostmi a RPC.
- Standalone stránka používá `SharedArrayBuffer`, pokud ho server/prohlížeč
  povolí. V iframe je připravená bezpečná záloha přes `ArrayBuffer`.
- ESP IDE používá pouze `ide-bridge.js`; USB, BLE a WebREPL ovladače se
  nemění.

## Etapy

### Etapa 1 – hotovo

- Worker s lokálním MicroPython WASM a startem `boot.py` → `main.py`.
- Virtuální souborový systém z aktuálního `files.lst`.
- `machine.Pin`, PWM, ADC, IRQ, I2C, SPI a NeoPixel most.
- Konfigurovatelná bitmapová scéna: LED, tlačítko, ADC, servo 180/360, DC
  motor s H-můstkem, rotační enkodér a NeoPixel řada.
- Výsuvný panel targetu `Simulator`; v ESP IDE vykresluje pouze scénu, zatímco
  run/stop, konzole, REPL a práce se soubory používají nativní IDE. Standalone
  URL si ponechává kompletní vývojový shell pro izolované testy.
- Klasický start REPLu (`mp.replInit()`), banner, echo a prompt `>>>`; vstupy
  se řadí sériově a výstup je dávkovaný s limitem proti zahlcení.
- Panel přebírá CSS proměnné a překlady ESP IDE včetně názvů komponent a
  tlačítek; standalone si zachovává vlastní světlé/tmavé výchozí schéma.
- Při běhu příkazu z friendly REPL se transport označí jako vytížený, takže
  Ctrl+C jde přímo do interrupt slotu a nezůstane za nekonečnou smyčkou.
- Statické testy, test přechodu úhlu přes 360° a živý smoke test v prohlížeči.

### Etapa 2 – další bezpečné periferie

1. Přidat obecný registrační katalog komponent, aby nový typ vyžadoval pouze
   modul rendereru, konfiguraci a test.
2. Doplnit OLED 128×64 s MONO_VLSB framebufferem a bitmapovým exportem stejného
   formátu jako reálné knihovny.
3. Doplnit virtuální sockety jako explicitní lokální endpointy; nepovolovat
   libovolné síťové spojení z Workeru.
4. Přidat další bitmapy do `assets/components/` a zachovat oddělené vrstvy
   `body.png`/`moving.png`, aby rotace neměla glitch při přechodu přes 360°.

### Etapa 3 – integrace a distribuce

1. Přidat volitelný konfigurátor JSON pro učitele, bez zásahu do runtime API.
2. Rozšířit File Manager ESP IDE o přehled virtuálního filesystému, pokud to
   bude potřeba pro výuku.
3. Teprve po ověření velikosti a aktualizačního procesu přidat simulátor do
   PWA precache; do té doby se načítá jako samostatný relativní modul.
4. Přidat regresní testy pro každou novou periferii a browser smoke scénáře.

## Akceptační kritéria před každou další etapou

- běžný target ESP32/ESP32-S3 se chová stejně jako před změnou;
- `boot.py` a `main.py` se spustí a seznam souborů odpovídá `files.lst`;
- dlouhá smyčka neblokuje hlavní stránku a jde zastavit Ctrl+C nebo bezpečným
  restartem Workeru v neizolovaném iframe;
- konfigurace, bitmapy a pinové vazby mají statickou kontrolu;
- výsledek se reportuje odděleně pro static/local, live browser/MCP a fyzické
  zařízení.
