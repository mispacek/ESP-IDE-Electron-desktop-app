# ESP IDE AI/MCP – průběžný backlog testování

Tento soubor je pracovní seznam překážek, chybějících funkcí a ověřených workaroundů pro svižnější automatizované testování ESP IDE. Není to changelog vydání. Po každém živém testu se sem doplní konkrétní zjištění nebo se aktualizuje stav existující položky.

## Jak zapisovat nové položky

- Jedna položka popisuje jednu konkrétní překážku nebo schopnost.
- Uvést datum, prostředí, pozorovaný projev, dopad, workaround, požadované řešení, prioritu a stav.
- Oddělit statickou validaci, živé ověření v prohlížeči, test na desce a test USB na hostiteli.
- Test na desce nebo upload označit jako ověřený jen tehdy, když skutečně proběhl na připojeném zařízení.

## Ověřený základní postup

1. Zkontrolovat `git status --short` a zachovat existující změny uživatele.
2. Spustit statickou validaci upraveného `.newblk` souboru.
3. V živém MCP načíst revizi workspace, provést dry-run, zkontrolovat Python a validaci, potvrdit se stejnou revizí a uschovat `undoToken`.
4. Jen na připojené desce nahrát soubory, spustit test a zachytit terminálový výsledek.
5. U USB testů ověřit enumeraci, deskriptory a reporty také na hostitelském systému.
6. Obnovit sériové připojení a podle potřeby vrátit testovací workspace přes `undoToken`.
7. Před dokončením spustit `tools/test-local-ai.ps1`.

## P0 – blokuje nebo výrazně zpomaluje testování

### MCP import a aktualizace lokálního doplňku

- Stav: otevřeno
- Zjištěno: 2026-07-14
- Projev: doplněk je nutné ručně znovu importovat a potvrdit „Uložit změny“.
- Dopad: nelze uzavřít automatický cyklus editace → reload → živý test.
- Požadavek: nástroje pro instalaci, aktualizaci a odebrání doplňku podle ID; validace metadat a delimiteru; reload toolboxu; výsledek s revizí a možností rollbacku.

### Toolbox discovery pro ručně importované doplňky

- Stav: otevřeno, workaround existuje
- Zjištěno: 2026-07-14
- Projev: kategorie je v DOM a typ bloku lze popsat, ale seznam bloků ji nevrátí a vytvoření s `fromToolbox:true` končí `TOOLBOX_TEMPLATE_NOT_FOUND`.
- Ověření 2026-07-14: po dočasném načtení `usb_hid_joystick` v1.1.0 šly nové typy `usb_hid_joy_axis` a `usb_hid_joy_button_value` popsat, ale `list_blocks` vrátil 0 výsledků. Přímé vytvoření, dry-run, commit, generování Pythonu, validace i undo prošly.
- Workaround: vytvořit registrovaný typ přímo s `fromToolbox:false`.
- Požadavek: sjednotit `list_blocks` a vytváření bloků s aktuálním sloučeným toolboxem včetně addonových shadow hodnot a výchozích polí.

### Automatické obnovení CDC po USB re-enumeraci

- Stav: otevřeno
- Zjištěno: 2026-07-14
- Projev: aktivace HID profilu přeruší současný COM/REPL transport; CDC se znovu objeví, ale IDE zůstane odpojené.
- Ověření 2026-07-14: také reload ESP IDE při dříve aktivním sériovém spojení vyvolal opakované `The device has been lost` a následné `No port selected by the user`; živý test proto nemohl bezpečně pokračovat uploadem na desku bez nového ručního připojení.
- Požadavek: sledovat návrat zařízení podle identity/VID/PID, najít případně nový COM port, bezpečně se znovu připojit a zobrazit průběh i timeout.

### Bezpečný hostitelský HID test

- Stav: otevřeno
- Zjištěno: 2026-07-14
- Dopad: ověření joysticku vyžaduje externí Python/hidapi a klávesnice či myš mohou nechtěně ovládat počítač.
- Požadavek: vypsat HID zařízení, usage page/usage a číst reporty; bezpečný režim musí předcházet nechtěné injekci kláves a pohybu myši.

## P1 – vysoká hodnota pro opakované testy

### Souborový systém desky přes MCP

- Stav: otevřeno
- Požadavek: list, mkdir, upload, download a hash; atomický upload s následným ověřením velikosti a SHA-256.

### Strojově čitelné verze a capabilities

- Stav: otevřeno
- Požadavek: vracet verzi ESP IDE a AI API, dostupnost helperů jako `espideAddonText`, procesor, transport, MicroPython firmware a dostupnost `machine.USBDevice`.

### Transakční hot-reload doplňku

- Stav: otevřeno
- Požadavek: znovu načíst JS i toolbox bez restartu stránky, obnovit flyout a při chybě vrátit předchozí funkční verzi.

### Výsledek běhu odolný proti ztrátě transportu

- Stav: otevřeno
- Požadavek: časová osa událostí před a po odpojení; rozlišit očekávanou USB re-enumeraci od pádu programu nebo zařízení.

### Snapshot a diff USB deskriptorů

- Stav: otevřeno
- Požadavek: uložit a porovnat rozhraní, endpointy, usage page/usage a stav zařízení ve Windows včetně Code 10.

## P2 – automatizace kvality

- Opakovatelné testovací profily pro neutrální a nenulové HID reporty klávesnice, myši a joysticku.
- Automaticky generovaný report se samostatnými výsledky statika / prohlížeč / deska / hostitel.
- Deklarované SHA-256 pro Base64 soubory uvnitř `.newblk` a kontrola jejich dekódování ve validátoru.

## Ověřené poznatky a workaroundy

- Pro importované addonové bloky lze dočasně obejít chybějící toolbox šablonu přímým vytvořením registrovaného typu.
- Dlouhý Base64 obsah přenášet po omezených částech a vždy ověřit dekódovaný SHA-256.
- Kompatibilitu s funkcí `espideAddonText` řešit feature detection, nikoli samotným porovnáním verze IDE.
- `builtin_driver=True` zachová CDC v nové USB konfiguraci, ale nezachová právě otevřenou REPL relaci během re-enumerace.
- Keyboard/mouse a joystick testovat jako oddělené profily; kombinace všech HID rozhraní s CDC na ověřené sestavě skončila Windows Code 10.

## Šablona nové položky

```text
### Krátký název

- Stav: otevřeno | rozpracováno | ověřeno | zamítnuto
- Priorita: P0 | P1 | P2
- Zjištěno: RRRR-MM-DD
- Prostředí:
- Projev a důkaz:
- Dopad:
- Workaround:
- Požadované řešení:
- Ověření řešení:
```
