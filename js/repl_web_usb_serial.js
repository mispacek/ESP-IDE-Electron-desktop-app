/* *****************************************************
 * Třída MicroPythonSerial – nová webserial komunikace *
 ******************************************************* */

class MicroPythonSerial {
  constructor(terminal) {
    this.terminal = terminal; // instance xterm.js
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.keepReading = false;
    this.inRawMode = false;       // Příznak raw REPL režimu
    this.rawResponseBuffer = "";  // Buffer pro odpovědi v raw režimu
    this.mute_terminal = false;
  }



  async connect() {
    try {
      // Vyžádej si od uživatele výběr zařízení
      this.port = await navigator.serial.requestPort();
      
      // Ověření, zda byl vybrán port         
      await this.port.open({ baudRate: 115200 });
      
      // Získáme reader a writer přímo z portu – bez pipeTo
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      
      this.keepReading = true;
      this.readLoop();

      this.terminal.write('\x1b[32mVítejte v ESP IDE!\x1b[m');
      //await mpSerial.sendData('\r\n');
      //await this.sendData("\x03"); // Ctrl-C
      //await delay(50);
      await this.sendData("\x02"); // Ctrl-B
      await delay(50);
      
    } catch (error) {
      console.error("Chyba při připojování:", error);
      
      
      if (error.message.indexOf('No port selected by the user') > -1) {
        this.terminal.writeln(`**Chyba při připojování: Nebyl vybrán žádný port.**`);
      }
      else if (error.message.indexOf('Failed to open serial port') > -1) {
        this.terminal.writeln(`**Chyba při připojování: Zvolený sériový port nelze otevřít.**`);
      } else {
        this.terminal.writeln(`**Chyba při připojování: ${error.message}**`);
      }
      
      
      this.reader = null;
      this.writer = null;
      this.disconnect();
      this.port = null; // zabrání znovupoužití starého objektu

    }
  }

  async disconnect() {
    try {
      this.keepReading = false;
      if (this.reader) {
        try {
          await this.reader.cancel();
        } catch (e) {
          console.warn("Chyba při cancel reader:", e);
        }
        try {
          this.reader.releaseLock();
        } catch (e) {
          console.warn("Chyba při releaseLock reader:", e);
        }
        this.reader = null;
      }
      if (this.writer) {
        try {
          await this.writer.close();
        } catch (e) {
          console.warn("Chyba při close writer:", e);
        }
        try {
          this.writer.releaseLock();
        } catch (e) {
          console.warn("Chyba při releaseLock writer:", e);
        }
        this.writer = null;
      }
      if (this.port) {
        try {
          await this.port.close();
        } catch (e) {
          console.warn("Chyba při close port:", e);
        }
        this.port = null;
      }
      this.terminal.writeln("**Zařízení odpojeno.**");
    } catch (error) {
      console.error("Chyba při odpojování:", error);
      this.terminal.writeln(`**Chyba při odpojování: ${error.message}**`);
    }
  }

  async readLoop() {
      const decoder = new TextDecoder();
      while (this.keepReading) {
        try {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) {
            const decoded = decoder.decode(value);
            if (this.inRawMode) {
              this.rawResponseBuffer += decoded;
            }
            
            if (this.mute_terminal == false) {
               this.terminal.write(decoded);
            }
            
          }
        } catch (error) {
          console.error("Chyba v readLoop:", error);
          break;
        }
      }
    }

  // Odeslání příkazu – přidá nový řádek, pokud není
  async sendCommand(command) {
    try {
      if (!this.writer) throw new Error("Nejsi připojen k zařízení.");
      if (!command.endsWith("\n")) command += "\r\n";
      const encoder = new TextEncoder();
      await this.writer.write(encoder.encode(command));
    } catch (error) {
      console.error("Chyba při odesílání příkazu:", error);
      this.terminal.writeln(`**Chyba při odesílání příkazu: ${error.message}**`);
    }
  }

  // Umožní psaní dat přímo z terminálu
  async sendData(data) {
    try {
      if (!this.writer) throw new Error("Nejsi připojen k zařízení.");
      const encoder = new TextEncoder();
      await this.writer.write(encoder.encode(data));
    } catch (error) {
      console.error("Chyba při odesílání dat:", error);
      this.terminal.writeln(`**Chyba při odesílání dat: ${error.message}**`);
    }
  }

  async enterRawREPL() {
    try {
      await this.sendData("\x03"); // Ctrl-C
      await new Promise(resolve => setTimeout(resolve, 100));
      this.inRawMode = true;
      await this.sendData("\x01"); // Ctrl-A
      let startTime = Date.now();
      while (Date.now() - startTime < 2000) {
        if (this.rawResponseBuffer.includes("raw REPL")) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!this.rawResponseBuffer.includes("raw REPL")) {
        throw new Error("Nepodařilo se vstoupit do raw REPL režimu.");
      }
      //this.terminal.writeln("**Vstoupeno do raw REPL režimu.**");
    } catch (error) {
      console.error("Chyba při vstupu do raw REPL:", error);
      this.terminal.writeln(`**Chyba při vstupu do raw REPL: ${error.message}**`);
    }
  }

  async exitRawREPL() {
    try {
      await this.sendData("\x02"); // Ctrl-B
      this.inRawMode = false;
      //this.terminal.writeln("**Opustil raw REPL režim.**");
    } catch (error) {
      console.error("Chyba při opouštění raw REPL:", error);
      this.terminal.writeln(`**Chyba při opouštění raw REPL: ${error.message}**`);
    }
  }

  async execRawCommand(command) {
      this.rawResponseBuffer = "";

      await this.sendCommand(command + "\r");
      await this.sendData("\x04"); // Signalizace konce příkazu

      let response = await new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkResponse = () => {
          // Čekáme na konec odpovědi indikovaný znakem EOT (\x04)
          //console.log("Prikaz: " + command);
          //console.log(this.rawResponseBuffer.split ('').map (function (c) { return c.charCodeAt (0); }));
          //console.log(this.rawResponseBuffer);
          if (this.rawResponseBuffer.includes("OK\x04")) {
            const result = this.rawResponseBuffer;
            this.rawResponseBuffer = "";
            resolve(result);
          } else if (Date.now() - startTime > 2000) {
            reject(new Error("Timeout při čekání na OK\\x04: " + this.rawResponseBuffer));
          } else {
            setTimeout(checkResponse, 10); // kontroluj každých 10 ms
          }
        };

        checkResponse();
      });

      return response;
    }


  splitIntoChunks(content, chunkSize) {
    let chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }
    return chunks;
  }

async sendFile(filename, content, init = false) {
  try {
    // Aktivuj progress bar
    const bar = document.getElementById("myProgress");
    bar.style.transition = "none";
    bar.style.opacity = 1;
    bar.style.width = "0%";
    
    
    // Vstup do raw REPL režimu
    await this.enterRawREPL();
    
    await this.execRawCommand(`\r\n`);
    
    
    await this.sendData("import os\r");
    await this.sendData("from ubinascii import a2b_base64\r\n");
    
    // Pokud cesta obsahuje adresář, zkontroluj a případně vytvoř adresář
    if (filename.includes("/")) {
        let folder = filename.substring(0, filename.lastIndexOf("/"));
        // Příkaz, který ověří existenci adresáře a pokud neexistuje, vytvoří ho
        await this.sendData(`try:\r`);
        await this.sendData(` os.stat("${folder}")\r`);
        await this.sendData(`except OSError:\r`);
        await this.execRawCommand(` os.mkdir("${folder}")\r`);
    }

    
    if (init == true)
    {
        await this.sendData("import gc\r");
        await this.sendData("import utime\r");
        
        await this.sendData("def run_code():\r");
        await this.sendData(" try:\r");
        await this.sendData("  gc.collect()\r");
        await this.sendData("  exec(open(\"idecode\").read())\r");
        await this.sendData(" except KeyboardInterrupt:\r");
        await this.sendData("  print('Zastaveni programu')\r");
        await this.sendData("  gc.collect()\r");
        await this.sendData("  stop_code()\r");
        
        await this.sendData("def stop_code():\r");
        await this.sendData(" try:\r");
        await this.sendData("  on_exit()\r");
        await this.sendData(" except:\r");
        await this.execRawCommand("  utime.sleep_ms(0)\r");
        await delay(50);
    }
    
    
    
    // Otevření souboru v binárním režimu ("wb")
    //await this.execRawCommand(`from ubinascii import a2b_base64`);
    await this.execRawCommand(`f = open("${filename}", "wb")`);
    await delay(50);
    
    // Převod textu do UTF-8 bajtů
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    const chunkSize = 64;
    
    // Pomocná funkce pro Base64 kódování Uint8Array chunku
    function base64EncodeUint8Array(uint8array) {
      let binary = "";
      for (let i = 0; i < uint8array.length; i++) {
        binary += String.fromCharCode(uint8array[i]);
      }
      return btoa(binary);
    }
    
    const totalChunks = Math.ceil(bytes.length / chunkSize);
    // Odeslání dat po chunkách
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      const base64Chunk = base64EncodeUint8Array(chunk);
      // Vytvoření příkazu pro zápis Base64 dat na zařízení
      await this.execRawCommand(`f.write(a2b_base64("${base64Chunk}"))`);
      //console.log(`f.write(a2b_base64("${base64Chunk}"))`);
      
      // Výpočet průběhu v %
      const percent = Math.min(Math.floor(((i + chunkSize) / bytes.length) * 100),100);
      this.terminal.write(`\rOdesílání: ${percent}%   `); // \r = návrat na začátek řádku
      
      // aktualizace progress baru
      bar.style.transition = "width 0.1s ease";
      bar.style.width = percent + "%";
    }
    
    // Uzavření souboru
    await this.execRawCommand("f.close()");
    await this.exitRawREPL();
    //this.terminal.writeln(`**Soubor ${filename} odeslán úspěšně.**`);
    
    // Skrytí progress baru po odeslání
    setTimeout(() => {
      bar.style.opacity = 0;
      bar.style.width = "0%";
    }, 500);
    
    this.terminal.writeln("");
  } catch (error) {
    console.error("Chyba při odesílání souboru:", error);
    this.terminal.writeln(`**Chyba při odesílání souboru: ${error.message}**`);
  }
}


}