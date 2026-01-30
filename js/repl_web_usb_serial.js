/* *****************************************************
 * MicroPythonSerial class - Web Serial transport
 ******************************************************* */

// === REPL i18n helpers ===
if (typeof window !== 'undefined') {
  if (!window.__espideReplFallbacks) window.__espideReplFallbacks = {};
  Object.assign(window.__espideReplFallbacks, {
    "repl.common.transferProgress": "Sending: {percent}%",
    "repl.common.programStopped": "Program stopped.",
    "repl.usb.connected": "Connected via USB - ESP IDE!",
    "repl.usb.noPortSelected": "Connect error: No port selected.",
    "repl.usb.openFailed": "Connect error: The selected serial port cannot be opened.",
    "repl.usb.connectError": "Connect error: {error}",
    "repl.usb.disconnected": "Device disconnected.",
    "repl.usb.disconnectError": "Disconnect error: {error}",
    "repl.usb.notConnected": "Device is not connected.",
    "repl.usb.sendCommandError": "Command send error: {error}",
    "repl.usb.sendDataError": "Data send error: {error}",
    "repl.usb.rawEnterFailed": "Failed to enter raw REPL mode.",
    "repl.usb.rawEnterError": "Raw REPL enter error: {error}",
    "repl.usb.rawExitError": "Raw REPL exit error: {error}",
    "repl.usb.rawOkTimeout": "Timeout waiting for OK\\x04: {buffer}",
    "repl.usb.sendFileError": "File send error: {error}"
  });
}
function replT(key, vars){
  try {
    if (typeof window !== 'undefined' && window.__espideI18n && typeof window.__espideI18n.t === 'function') {
      return window.__espideI18n.t(key, vars);
    }
    if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(key, vars);
  } catch (_) {}
  const base = (typeof window !== 'undefined' && window.__espideReplFallbacks && window.__espideReplFallbacks[key]) || key;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

function asBytes(x){
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  return new TextEncoder().encode(String(x ?? ''));
}


class MicroPythonSerial {
  constructor(terminal) {
    this.terminal = terminal; // instance xterm.js
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.keepReading = false;
    this.inRawMode = false;       // raw REPL mode flag
    this.rawResponseBuffer = "";  // raw REPL response buffer
    this.mute_terminal = false;
    
    this.fm_in_buffer  = "";
    this.fm_buf_enabled = true;            // always collect
    this.fm_buf_limit   = 262144;          // 256 KiB overflow guard
  }



  async connect() {
    try {
      // Ask the user to select a device
      this.port = await navigator.serial.requestPort();
      
      // Open the selected port
      await this.port.open({ baudRate: 115200 });
      
      // Get reader/writer directly from the port (no pipeTo)
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      
      this.keepReading = true;
      this.readLoop();

      this.terminal.write('\x1b[32m' + replT("repl.usb.connected") + '\x1b[m');
      //await mpSerial.sendData('\r\n');
      //await this.sendData("\x03"); // Ctrl-C
      //await delay(50);
      await this.sendData("\x02"); // Ctrl-B
      await delay(50);
      
    } catch (error) {
      console.error("Connect error:", error);
      
      
      if (error.message.indexOf('No port selected by the user') > -1) {
        this.terminal.writeln("**" + replT("repl.usb.noPortSelected") + "**");
      }
      else if (error.message.indexOf('Failed to open serial port') > -1) {
        this.terminal.writeln("**" + replT("repl.usb.openFailed") + "**");
      } else {
        this.terminal.writeln("**" + replT("repl.usb.connectError", { error: error.message }) + "**");
      }
      
      
      this.reader = null;
      this.writer = null;
      this.disconnect();
      this.port = null; // prevent reuse of a stale object

    }
  }

  async disconnect() {
    try {
      this.keepReading = false;
      if (this.reader) {
        try {
          await this.reader.cancel();
        } catch (e) {
          console.warn("Reader cancel error:", e);
        }
        try {
          this.reader.releaseLock();
        } catch (e) {
          console.warn("Reader releaseLock error:", e);
        }
        this.reader = null;
      }
      if (this.writer) {
        try {
          await this.writer.close();
        } catch (e) {
          console.warn("Writer close error:", e);
        }
        try {
          this.writer.releaseLock();
        } catch (e) {
          console.warn("Writer releaseLock error:", e);
        }
        this.writer = null;
      }
      if (this.port) {
        try {
          await this.port.close();
        } catch (e) {
          console.warn("Port close error:", e);
        }
        this.port = null;
      }
      this.terminal.writeln("**" + replT("repl.usb.disconnected") + "**");
    } catch (error) {
      console.error("Disconnect error:", error);
      this.terminal.writeln("**" + replT("repl.usb.disconnectError", { error: error.message }) + "**");
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
            
            if (this.fm_buf_enabled) {
              this.fm_in_buffer += decoded;
              if (this.fm_in_buffer.length > this.fm_buf_limit) {
                this.fm_in_buffer = this.fm_in_buffer.slice(-this.fm_buf_limit);
              }
            }

          }
        } catch (error) {
          console.error("readLoop error:", error);
          break;
        }
      }
    }

  // Send a command, append a newline when missing
  async sendCommand(command) {
    try {
      if (!this.writer) throw new Error(replT("repl.usb.notConnected"));
      if (!command.endsWith("\n")) command += "\r\n";
      const encoder = new TextEncoder();
      await this.writer.write(encoder.encode(command));
    } catch (error) {
      console.error("Command send error:", error);
      this.terminal.writeln("**" + replT("repl.usb.sendCommandError", { error: error.message }) + "**");
    }
  }

  // Send raw data from the terminal
  async sendData(data) {
    try {
      if (!this.writer) throw new Error(replT("repl.usb.notConnected"));
      const encoder = new TextEncoder();
      await this.writer.write(encoder.encode(data));
    } catch (error) {
      console.error("Data send error:", error);
      this.terminal.writeln("**" + replT("repl.usb.sendDataError", { error: error.message }) + "**");
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
        throw new Error(replT("repl.usb.rawEnterFailed"));
      }
      //this.terminal.writeln("**Entered raw REPL mode.**");
    } catch (error) {
      console.error("Raw REPL enter error:", error);
      this.terminal.writeln("**" + replT("repl.usb.rawEnterError", { error: error.message }) + "**");
    }
  }

  async exitRawREPL() {
    try {
      await this.sendData("\x02"); // Ctrl-B
      this.inRawMode = false;
      //this.terminal.writeln("**Exited raw REPL mode.**");
    } catch (error) {
      console.error("Raw REPL exit error:", error);
      this.terminal.writeln("**" + replT("repl.usb.rawExitError", { error: error.message }) + "**");
    }
  }

  async execRawCommand(command) {
      this.rawResponseBuffer = "";

      await this.sendCommand(command + "\r");
      await this.sendData("\x04"); // signal end of command

      let response = await new Promise((resolve, reject) => {
        const startTime = Date.now();

        const checkResponse = () => {
          // Wait for response end indicated by EOT (\x04)
          //console.log("Prikaz: " + command);
          //console.log(this.rawResponseBuffer.split ('').map (function (c) { return c.charCodeAt (0); }));
          //console.log(this.rawResponseBuffer);
          if (this.rawResponseBuffer.includes("OK\x04")) {
            const result = this.rawResponseBuffer;
            this.rawResponseBuffer = "";
            resolve(result);
          } else if (Date.now() - startTime > 2500) {
            reject(new Error(replT("repl.usb.rawOkTimeout", { buffer: this.rawResponseBuffer })));
          } else {
            setTimeout(checkResponse, 10); // poll every 10 ms
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
    // Activate the progress bar
    const bar = document.getElementById("myProgress");
    bar.style.transition = "none";
    bar.style.opacity = 1;
    bar.style.width = "0%";
    
    
    // Enter raw REPL mode
    await this.enterRawREPL();
    
    await this.execRawCommand(`\r\n`);
    
    
    await this.sendData("import os\r");
    await this.sendData("from ubinascii import a2b_base64\r\n");
    
    // If the path includes a folder, ensure it exists
    if (filename.includes("/")) {
        let folder = filename.substring(0, filename.lastIndexOf("/"));
        // Check if the folder exists, create it when missing
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
        await this.sendData("  print('" + replT("repl.common.programStopped") + "')\r");
        await this.sendData("  gc.collect()\r");
        await this.sendData("  stop_code()\r");
        
        await this.sendData("def stop_code():\r");
        await this.sendData(" try:\r");
        await this.sendData("  on_exit()\r");
        await this.sendData(" except:\r");
        await this.execRawCommand("  utime.sleep_ms(0)\r");
        await delay(50);
    }
    
    
    
    // Open file in binary mode ("wb")
    //await this.execRawCommand(`from ubinascii import a2b_base64`);
    await this.execRawCommand(`f = open("${filename}", "wb")`);
    await delay(50);
    
    // Convert content to bytes
    const bytes = asBytes(content);
    const chunkSize = 64;
    
    // Helper for Base64 encoding a Uint8Array chunk
    function base64EncodeUint8Array(uint8array) {
      let binary = "";
      for (let i = 0; i < uint8array.length; i++) {
        binary += String.fromCharCode(uint8array[i]);
      }
      return btoa(binary);
    }
    
    const totalChunks = Math.ceil(bytes.length / chunkSize);
    // Send data in chunks
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.slice(i, i + chunkSize);
      const base64Chunk = base64EncodeUint8Array(chunk);
      // Build a command to write base64 data on the device
      await this.execRawCommand(`f.write(a2b_base64("${base64Chunk}"))`);
      //console.log(`f.write(a2b_base64("${base64Chunk}"))`);
      
      // Progress percent
      const percent = Math.min(Math.floor(((i + chunkSize) / bytes.length) * 100),100);
      this.terminal.write("\r" + replT("repl.common.transferProgress", { percent }) + "   "); // \r = return to line start
      
      // aktualizace progress baru
      bar.style.transition = "width 0.1s ease";
      bar.style.width = percent + "%";
    }
    
    // Close the file
    await this.execRawCommand("f.close()");
    await this.exitRawREPL();
    //this.terminal.writeln(`**File ${filename} sent successfully.**`);
    
    // Hide the progress bar after upload
    setTimeout(() => {
      bar.style.opacity = 0;
      bar.style.width = "0%";
    }, 500);
    
    this.terminal.writeln("");
  } catch (error) {
    console.error("File send error:", error);
    this.terminal.writeln("**" + replT("repl.usb.sendFileError", { error: error.message }) + "**");
  }
}


  fmEnable(on){ this.fm_buf_enabled = !!on; }
  fmClear(){ this.fm_in_buffer = ""; }
  fmPeek(){ return this.fm_in_buffer; }
  fmTakeAll(){ const s = this.fm_in_buffer; this.fm_in_buffer = ""; return s; }




}
