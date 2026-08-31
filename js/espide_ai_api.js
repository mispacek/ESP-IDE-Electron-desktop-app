(function (global) {
  "use strict";

  const API_VERSION = "1.0.0";
  const MAX_UNDO_ENTRIES = 20;
  const MAX_TERMINAL_LINES = 2000;
  const listeners = new Map();
  const undoStack = [];
  const terminalLines = [];

  let context = {};
  let initialized = false;
  let revision = 0;
  let transactionActive = false;
  let workspaceListener = null;
  let observedWorkspace = null;
  let terminalPartial = "";
  let terminalWrapped = false;
  let lastConnectionState = "";

  function nowIso() {
    return new Date().toISOString();
  }

  function makeError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    if (details !== undefined) error.details = details;
    return error;
  }

  function cloneJson(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function redactSecrets(value) {
    if (Array.isArray(value)) return value.map(redactSecrets);
    if (!value || typeof value !== "object") return value;
    const out = {};
    Object.keys(value).forEach((key) => {
      if (/(password|passwd|token|secret|credential|authorization)/i.test(key)) {
        out[key] = "[redacted]";
      } else {
        out[key] = redactSecrets(value[key]);
      }
    });
    return out;
  }

  function emit(type, data) {
    const event = {
      type,
      at: nowIso(),
      revision,
      data: data === undefined ? null : cloneJson(data)
    };
    const targets = [];
    if (listeners.has(type)) targets.push(...listeners.get(type));
    if (listeners.has("*")) targets.push(...listeners.get("*"));
    targets.forEach((handler) => {
      try { handler(event); } catch (error) { console.warn("ESPIDE_AI event handler failed:", error); }
    });
    try {
      global.dispatchEvent(new CustomEvent("espide-ai-event", { detail: event }));
    } catch (_) {}
    return event;
  }

  function subscribe(type, handler) {
    if (typeof handler !== "function") throw makeError("INVALID_HANDLER", "Event handler must be a function.");
    const key = String(type || "*");
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(handler);
    return function unsubscribe() {
      const set = listeners.get(key);
      if (!set) return;
      set.delete(handler);
      if (!set.size) listeners.delete(key);
    };
  }

  function getWorkspace() {
    if (typeof context.getWorkspace === "function") return context.getWorkspace();
    return global.demoWorkspace || (global.Blockly && typeof global.Blockly.getMainWorkspace === "function"
      ? global.Blockly.getMainWorkspace()
      : null);
  }

  function requireWorkspace() {
    const workspace = getWorkspace();
    if (!workspace) throw makeError("WORKSPACE_NOT_READY", "Blockly workspace is not initialized yet.");
    return workspace;
  }

  function getToolboxRoot() {
    if (typeof context.getToolboxRoot === "function") return context.getToolboxRoot();
    return global.document && global.document.getElementById("toolbox");
  }

  function parseXml(xmlText) {
    if (!global.Blockly || !global.Blockly.Xml) throw makeError("BLOCKLY_NOT_READY", "Blockly XML support is not initialized.");
    return global.Blockly.Xml.textToDom(String(xmlText || ""));
  }

  function serializeXml(dom) {
    if (!global.Blockly || !global.Blockly.Xml) throw makeError("BLOCKLY_NOT_READY", "Blockly XML support is not initialized.");
    return global.Blockly.Xml.domToText(dom);
  }

  function elementChildren(parent, tagName) {
    const expected = tagName ? String(tagName).toLowerCase() : null;
    const result = [];
    if (!parent) return result;
    for (const node of parent.childNodes || []) {
      if (node.nodeType !== 1) continue;
      if (!expected || String(node.nodeName).toLowerCase() === expected) result.push(node);
    }
    return result;
  }

  function elementToObject(node) {
    if (!node || node.nodeType !== 1) return null;
    const out = { tag: String(node.nodeName).toLowerCase(), attrs: {}, text: "", children: [] };
    for (const attr of node.attributes || []) out.attrs[attr.name] = attr.value;
    for (const child of node.childNodes || []) {
      if (child.nodeType === 1) {
        const parsed = elementToObject(child);
        if (parsed) out.children.push(parsed);
      } else if (child.nodeType === 3 || child.nodeType === 4) {
        const text = String(child.nodeValue || "").trim();
        if (text) out.text += text;
      }
    }
    return out;
  }

  function getToolboxXmlText() {
    const toolbox = getToolboxRoot();
    return toolbox ? '<xml id="toolbox" style="display: none">' + toolbox.innerHTML + "</xml>" : "";
  }

  function walkToolboxCategories(parent, parentPath, out) {
    for (const category of elementChildren(parent, "category")) {
      const name = category.getAttribute("name") || category.getAttribute("data-i18n-name") || "";
      const path = parentPath.concat([name]);
      for (const block of elementChildren(category, "block")) {
        out.push({
          category: name,
          categoryPath: path,
          type: block.getAttribute("type") || "",
          disabled: block.getAttribute("disabled") === "true",
          xml: serializeXml(block),
          spec: elementToObject(block)
        });
      }
      walkToolboxCategories(category, path, out);
    }
  }

  function listToolboxBlocks() {
    const toolbox = getToolboxRoot();
    if (!toolbox) return [];
    const items = [];
    walkToolboxCategories(toolbox, [], items);
    return items;
  }

  function findToolboxBlockTemplate(type) {
    const wanted = String(type || "");
    const toolbox = getToolboxRoot();
    if (!toolbox) return null;
    const stack = [{ node: toolbox, path: [] }];
    while (stack.length) {
      const current = stack.pop();
      for (const category of elementChildren(current.node, "category")) {
        const name = category.getAttribute("name") || category.getAttribute("data-i18n-name") || "";
        const path = current.path.concat([name]);
        for (const block of elementChildren(category, "block")) {
          if ((block.getAttribute("type") || "") === wanted) {
            return { category: name, categoryPath: path, blockNode: block };
          }
        }
        stack.push({ node: category, path });
      }
    }
    return null;
  }

  function describeBlockType(type) {
    const workspace = requireWorkspace();
    const block = workspace.newBlock(String(type || ""));
    try {
      if (typeof block.initSvg === "function") block.initSvg();
      if (typeof block.render === "function") block.render();
      return {
        type: block.type,
        styleName: block.styleName_ || null,
        colour: typeof block.getColour === "function" ? block.getColour() : null,
        previous: !!block.previousConnection,
        next: !!block.nextConnection,
        output: !!block.outputConnection,
        previousChecks: block.previousConnection ? block.previousConnection.getCheck() : null,
        nextChecks: block.nextConnection ? block.nextConnection.getCheck() : null,
        outputChecks: block.outputConnection ? block.outputConnection.getCheck() : null,
        inputs: (block.inputList || []).map((input) => ({
          name: input.name,
          type: input.type,
          connectionChecks: input.connection ? input.connection.getCheck() : null,
          fields: (input.fieldRow || []).map((field) => ({
            name: field.name || null,
            value: typeof field.getValue === "function" ? field.getValue() : null,
            text: typeof field.getText === "function" ? field.getText() : null
          }))
        }))
      };
    } finally {
      block.dispose(false);
    }
  }

  function createBlock(type, options) {
    const opts = options || {};
    const workspace = requireWorkspace();
    const block = workspace.newBlock(String(type || ""));
    if (typeof block.initSvg === "function") block.initSvg();
    if (opts.fields) {
      Object.entries(opts.fields).forEach(([fieldName, value]) => {
        if (block.getField(fieldName)) block.setFieldValue(String(value), fieldName);
      });
    }
    if (typeof block.render === "function") block.render();
    if (typeof opts.x === "number" || typeof opts.y === "number") {
      block.moveBy(typeof opts.x === "number" ? opts.x : 0, typeof opts.y === "number" ? opts.y : 0);
    }
    return block;
  }

  function createBlockFromToolbox(type, options) {
    const opts = options || {};
    const workspace = requireWorkspace();
    const template = findToolboxBlockTemplate(type);
    if (!template || !template.blockNode) {
      throw makeError("TOOLBOX_TEMPLATE_NOT_FOUND", "Toolbox template not found for block type: " + type);
    }
    const xml = global.document.createElement("xml");
    const blockNode = template.blockNode.cloneNode(true);
    if (typeof opts.x === "number") blockNode.setAttribute("x", String(opts.x));
    if (typeof opts.y === "number") blockNode.setAttribute("y", String(opts.y));
    xml.appendChild(blockNode);
    const ids = global.Blockly.Xml.domToWorkspace(xml, workspace) || [];
    let block = null;
    for (const id of ids) {
      const candidate = workspace.getBlockById(id);
      if (candidate && candidate.type === type && (!candidate.getParent || !candidate.getParent())) {
        block = candidate;
        break;
      }
    }
    if (!block && ids.length) block = workspace.getBlockById(ids[0]);
    if (!block) throw makeError("BLOCK_CREATE_FAILED", "Failed to create block from toolbox template: " + type);
    if (opts.fields) {
      Object.entries(opts.fields).forEach(([fieldName, value]) => {
        if (block.getField(fieldName)) block.setFieldValue(String(value), fieldName);
      });
    }
    if (typeof block.render === "function") block.render();
    return block;
  }

  function getBlock(ref, aliases) {
    const workspace = requireWorkspace();
    if (!ref) return null;
    if (typeof ref !== "string") return ref;
    const resolved = aliases && aliases[ref] ? aliases[ref] : ref;
    return workspace.getBlockById(resolved);
  }

  function requireBlock(ref, aliases) {
    const block = getBlock(ref, aliases);
    if (!block) throw makeError("BLOCK_NOT_FOUND", "Block not found: " + ref);
    return block;
  }

  function connectSequence(parentRef, childRef, aliases) {
    const parent = requireBlock(parentRef, aliases);
    const child = requireBlock(childRef, aliases);
    if (!parent.nextConnection || !child.previousConnection) {
      throw makeError("CONNECTION_NOT_AVAILABLE", "Sequence connection is not available.");
    }
    parent.nextConnection.connect(child.previousConnection);
    if (typeof child.render === "function") child.render();
    return true;
  }

  function connectInput(parentRef, inputName, childRef, aliases) {
    const parent = requireBlock(parentRef, aliases);
    const child = requireBlock(childRef, aliases);
    const input = parent.getInput(String(inputName || ""));
    if (!input || !input.connection) throw makeError("INPUT_NOT_FOUND", "Input connection not found: " + inputName);
    let target = null;
    if (global.Blockly && input.type === global.Blockly.INPUT_VALUE) target = child.outputConnection;
    else target = child.previousConnection;
    if (!target) throw makeError("CHILD_CONNECTION_NOT_FOUND", "Child block has no compatible connection.");
    input.connection.connect(target);
    if (typeof child.render === "function") child.render();
    return true;
  }

  function loadXml(xmlText, clearFirst) {
    const workspace = requireWorkspace();
    const xml = parseXml(xmlText);
    global.Blockly.Events.disable();
    try {
      if (clearFirst) workspace.clear();
      global.Blockly.Xml.domToWorkspace(xml, workspace);
    } finally {
      global.Blockly.Events.enable();
      if (typeof context.onWorkspaceLayout === "function") context.onWorkspaceLayout(workspace);
    }
    return workspace.getAllBlocks(false).map((block) => block.id);
  }

  function workspaceToXml() {
    return serializeXml(global.Blockly.Xml.workspaceToDom(requireWorkspace()));
  }

  function clearWorkspace() {
    requireWorkspace().clear();
    return true;
  }

  function getGeneratedCodeValue() {
    if (typeof context.getGeneratedCode === "function") return String(context.getGeneratedCode() || "");
    const workspace = requireWorkspace();
    if (!global.Blockly || !global.Blockly.Python) throw makeError("GENERATOR_NOT_READY", "Blockly Python generator is not initialized.");
    global.Blockly.Python.INFINITE_LOOP_TRAP = null;
    return String(global.Blockly.Python.workspaceToCode(workspace) || "");
  }

  function getLocale() {
    if (typeof context.getLocale === "function") return String(context.getLocale() || "en");
    return String((global.document && global.document.documentElement.lang) || "en");
  }

  function getSettings() {
    const settings = typeof context.getSettings === "function" ? context.getSettings() : (global.userSettings || {});
    return redactSecrets(cloneJson(settings || {}));
  }

  function getAddons() {
    const source = typeof context.getAddons === "function" ? context.getAddons() : (global.extensions || {});
    return Object.keys(source || {}).sort().map((name) => {
      const addon = source[name] || {};
      return {
        name,
        id: addon.id || name,
        enabled: addon.enabled !== false,
        version: addon.version || null,
        description: addon.description || null,
        author: addon.author || null,
        tags: Array.isArray(addon.tags) ? addon.tags.slice() : [],
        toolboxMode: addon.toolbox_mode || null,
        hasJavascript: !!String(addon.js || "").trim(),
        hasToolbox: !!String(addon.xml || "").trim()
      };
    });
  }

  function getConnectionState() {
    if (typeof context.getConnectionState === "function") return cloneJson(context.getConnectionState());
    return { connected: false, activeLink: "none" };
  }

  function getState() {
    const workspace = getWorkspace();
    const connection = getConnectionState();
    return {
      apiVersion: API_VERSION,
      initialized,
      revision,
      locale: getLocale(),
      processor: (getSettings() || {}).processor || null,
      projectMode: typeof context.getProjectMode === "function" ? context.getProjectMode() : null,
      blockCount: workspace ? workspace.getAllBlocks(false).length : 0,
      connection,
      undoDepth: undoStack.length
    };
  }

  function notifyConnectionChanged() {
    const next = getConnectionState();
    const serialized = JSON.stringify(next);
    if (serialized === lastConnectionState) return false;
    lastConnectionState = serialized;
    emit("connection.changed", next);
    return true;
  }

  function notifyLocaleChanged() {
    emit("locale.changed", { locale: getLocale() });
    return true;
  }

  function notifyToolboxChanged(reason) {
    emit("toolbox.changed", {
      reason: reason || null,
      locale: getLocale(),
      processor: getSettings().processor || null,
      blockCount: listToolboxBlocks().length
    });
    return true;
  }

  function stripAnsi(value) {
    return String(value || "")
      .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
      .replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
  }

  function captureTerminal(data) {
    const raw = String(data === undefined ? "" : data);
    if (!raw) return;
    const normalized = stripAnsi(raw).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = (terminalPartial + normalized).split("\n");
    terminalPartial = parts.pop() || "";
    for (const line of parts) terminalLines.push(line);
    if (terminalLines.length > MAX_TERMINAL_LINES) terminalLines.splice(0, terminalLines.length - MAX_TERMINAL_LINES);
    emit("terminal.data", { text: raw });
  }

  function wrapTerminal() {
    if (terminalWrapped) return;
    const terminal = typeof context.getTerminal === "function" ? context.getTerminal() : global.term;
    if (!terminal || typeof terminal.write !== "function") return;
    const originalWrite = terminal.write;
    terminal.write = function (data) {
      captureTerminal(data);
      return originalWrite.apply(this, arguments);
    };
    terminalWrapped = true;
  }

  function getTerminalTail(options) {
    const opts = options || {};
    const requested = Number(opts.lines || 100);
    const count = Number.isFinite(requested) ? Math.max(1, Math.min(1000, Math.trunc(requested))) : 100;
    const lines = terminalLines.slice(-count);
    if (terminalPartial) lines.push(terminalPartial);
    return { lines, text: lines.join("\n"), capturedLineCount: terminalLines.length };
  }

  function getWorkspaceSnapshot() {
    const workspace = requireWorkspace();
    const selected = global.Blockly && global.Blockly.selected;
    return {
      revision,
      xml: workspaceToXml(),
      blockCount: workspace.getAllBlocks(false).length,
      topBlockIds: workspace.getTopBlocks(false).map((block) => block.id),
      selectedBlockId: selected && selected.workspace === workspace ? selected.id : null
    };
  }

  function queryToolboxBlocks(options) {
    const opts = options || {};
    const query = String(opts.query || "").trim().toLowerCase();
    const category = String(opts.category || "").trim().toLowerCase();
    const requestedLimit = Number(opts.limit || 200);
    const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(1000, Math.trunc(requestedLimit))) : 200;
    let blocks = listToolboxBlocks().filter((block) => {
      const path = (block.categoryPath || []).join(" / ");
      if (category && !path.toLowerCase().includes(category)) return false;
      if (query && !(block.type + " " + path).toLowerCase().includes(query)) return false;
      return true;
    });
    const total = blocks.length;
    blocks = blocks.slice(0, limit).map((block) => {
      const item = Object.assign({}, block);
      if (opts.includeXml !== true) delete item.xml;
      if (opts.includeSpec !== true) delete item.spec;
      return item;
    });
    return { blocks, total, truncated: total > blocks.length };
  }

  function validateWorkspace() {
    const workspace = requireWorkspace();
    const errors = [];
    const warnings = [];
    let xml = "";
    let code = "";
    try {
      xml = workspaceToXml();
      parseXml(xml);
    } catch (error) {
      errors.push({ code: "WORKSPACE_XML_INVALID", message: error.message });
    }
    try {
      code = getGeneratedCodeValue();
    } catch (error) {
      errors.push({ code: "PYTHON_GENERATION_FAILED", message: error.message });
    }
    for (const block of workspace.getAllBlocks(false)) {
      try {
        const warning = typeof block.getWarningText === "function" ? block.getWarningText() : null;
        if (warning) warnings.push({ code: "BLOCK_WARNING", blockId: block.id, blockType: block.type, message: warning });
        if (block.outputConnection && !block.outputConnection.targetConnection) {
          warnings.push({
            code: "ORPHAN_OUTPUT_BLOCK",
            blockId: block.id,
            blockType: block.type,
            message: "Output block is not connected to a value input."
          });
        }
      } catch (error) {
        warnings.push({ code: "BLOCK_INSPECTION_FAILED", blockId: block.id, blockType: block.type, message: error.message });
      }
    }
    if (workspace.getAllBlocks(false).length && !code.trim()) {
      warnings.push({ code: "EMPTY_GENERATED_CODE", message: "Workspace contains blocks but generated Python is empty." });
    }
    return {
      valid: errors.length === 0,
      revision,
      errors,
      warnings,
      code,
      xml,
      blockCount: workspace.getAllBlocks(false).length
    };
  }

  function restoreWorkspaceXml(xmlText) {
    const workspace = requireWorkspace();
    const dom = parseXml(xmlText);
    global.Blockly.Events.disable();
    try {
      workspace.clear();
      global.Blockly.Xml.domToWorkspace(dom, workspace);
    } finally {
      global.Blockly.Events.enable();
      if (typeof context.onWorkspaceLayout === "function") context.onWorkspaceLayout(workspace);
    }
  }

  function moveBlockAbsolute(block, x, y) {
    if (typeof block.getRelativeToSurfaceXY === "function") {
      const current = block.getRelativeToSurfaceXY();
      block.moveBy(Number(x) - Number(current.x), Number(y) - Number(current.y));
    } else {
      block.moveBy(Number(x), Number(y));
    }
  }

  function applyOperation(operation, aliases) {
    const op = operation || {};
    switch (op.op) {
      case "clear":
        requireWorkspace().clear();
        return { op: op.op };
      case "replace_xml":
        restoreWorkspaceXml(op.xml);
        return { op: op.op };
      case "create": { 
        if (!op.type) throw makeError("INVALID_OPERATION", "create requires a block type.");
        const block = op.fromToolbox === false
          ? createBlock(op.type, op)
          : createBlockFromToolbox(op.type, op);
        if (op.ref) {
          if (aliases[op.ref]) throw makeError("DUPLICATE_ALIAS", "Duplicate block alias: " + op.ref);
          aliases[op.ref] = block.id;
        }
        return { op: op.op, ref: op.ref || null, blockId: block.id, blockType: block.type };
      }
      case "set_field": { 
        const block = requireBlock(op.block, aliases);
        if (!op.field || !block.getField(op.field)) throw makeError("FIELD_NOT_FOUND", "Field not found: " + op.field);
        block.setFieldValue(String(op.value), op.field);
        if (typeof block.render === "function") block.render();
        return { op: op.op, blockId: block.id, field: op.field };
      }
      case "connect_sequence":
        connectSequence(op.parent, op.child, aliases);
        return { op: op.op, parent: op.parent, child: op.child };
      case "connect_input":
        connectInput(op.parent, op.input, op.child, aliases);
        return { op: op.op, parent: op.parent, input: op.input, child: op.child };
      case "move": { 
        const block = requireBlock(op.block, aliases);
        if (!Number.isFinite(Number(op.x)) || !Number.isFinite(Number(op.y))) {
          throw makeError("INVALID_POSITION", "move requires numeric x and y values.");
        }
        moveBlockAbsolute(block, op.x, op.y);
        return { op: op.op, blockId: block.id, x: Number(op.x), y: Number(op.y) };
      }
      case "disconnect": { 
        const block = requireBlock(op.block, aliases);
        const connection = op.connection === "output"
          ? block.outputConnection
          : op.connection === "next"
            ? block.nextConnection
            : block.previousConnection;
        if (!connection) throw makeError("CONNECTION_NOT_AVAILABLE", "Requested block connection is not available.");
        if (connection.isConnected()) connection.disconnect();
        return { op: op.op, blockId: block.id, connection: op.connection || "previous" };
      }
      case "delete": { 
        const block = requireBlock(op.block, aliases);
        const id = block.id;
        block.dispose(op.healStack === true);
        return { op: op.op, blockId: id };
      }
      default:
        throw makeError("UNKNOWN_OPERATION", "Unsupported workspace patch operation: " + op.op);
    }
  }

  function newUndoToken() {
    return "espide-undo-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function applyWorkspacePatch(patch) {
    const request = patch || {};
    if (!Array.isArray(request.operations) || !request.operations.length) {
      throw makeError("EMPTY_PATCH", "Workspace patch must contain at least one operation.");
    }
    if (request.expectedRevision !== undefined && request.expectedRevision !== null && Number(request.expectedRevision) !== revision) {
      throw makeError("REVISION_CONFLICT", "Workspace changed since the patch was prepared.", {
        expectedRevision: Number(request.expectedRevision),
        actualRevision: revision
      });
    }
    if (transactionActive) throw makeError("TRANSACTION_BUSY", "Another ESPIDE_AI workspace transaction is active.");

    const beforeXml = workspaceToXml();
    const aliases = {};
    const applied = [];
    const previousRevision = revision;
    transactionActive = true;
    global.Blockly.Events.disable();
    try {
      for (const operation of request.operations) applied.push(applyOperation(operation, aliases));
      const validation = validateWorkspace();
      if (!validation.valid) {
        throw makeError("PATCH_VALIDATION_FAILED", "Workspace patch failed validation.", validation);
      }
      const result = {
        committed: request.dryRun !== true,
        dryRun: request.dryRun === true,
        description: request.description || null,
        previousRevision,
        revision: request.dryRun === true ? revision : revision + 1,
        aliases: cloneJson(aliases),
        applied,
        validation,
        workspace: getWorkspaceSnapshot(),
        undoToken: null
      };
      if (request.dryRun === true) {
        restoreWorkspaceXml(beforeXml);
        result.workspace = getWorkspaceSnapshot();
      } else {
        revision += 1;
        const entry = {
          token: newUndoToken(),
          description: request.description || null,
          beforeXml,
          committedRevision: revision
        };
        undoStack.push(entry);
        if (undoStack.length > MAX_UNDO_ENTRIES) undoStack.shift();
        result.revision = revision;
        result.workspace.revision = revision;
        result.undoToken = entry.token;
      }
      emit(request.dryRun === true ? "transaction.previewed" : "transaction.committed", result);
      return result;
    } catch (error) {
      try { restoreWorkspaceXml(beforeXml); } catch (restoreError) { console.error("ESPIDE_AI rollback failed:", restoreError); }
      revision = previousRevision;
      emit("transaction.rolled_back", {
        description: request.description || null,
        error: { code: error.code || "PATCH_FAILED", message: error.message, details: error.details || null }
      });
      throw error;
    } finally {
      global.Blockly.Events.enable();
      transactionActive = false;
      if (typeof context.onWorkspaceLayout === "function") context.onWorkspaceLayout(requireWorkspace());
    }
  }

  function undoWorkspacePatch(options) {
    const opts = options || {};
    if (!undoStack.length) throw makeError("UNDO_EMPTY", "No ESPIDE_AI workspace transaction is available to undo.");
    const entry = undoStack[undoStack.length - 1];
    if (opts.token && opts.token !== entry.token) {
      throw makeError("UNDO_TOKEN_MISMATCH", "Only the most recent workspace transaction can be undone.", {
        requestedToken: opts.token,
        latestToken: entry.token
      });
    }
    transactionActive = true;
    try {
      restoreWorkspaceXml(entry.beforeXml);
      undoStack.pop();
      revision += 1;
      const result = {
        undone: true,
        token: entry.token,
        description: entry.description,
        revision,
        workspace: getWorkspaceSnapshot()
      };
      emit("transaction.undone", result);
      return result;
    } finally {
      transactionActive = false;
    }
  }

  function capabilities() {
    return {
      apiVersion: API_VERSION,
      patchVersion: "1.0",
      events: [
        "ready", "workspace.changed", "connection.changed", "locale.changed", "toolbox.changed", "terminal.data",
        "transaction.previewed", "transaction.committed", "transaction.rolled_back", "transaction.undone"
      ],
      tools: [
        { name: "get_capabilities", mutates: false },
        { name: "get_state", mutates: false },
        { name: "list_blocks", mutates: false },
        { name: "describe_block", mutates: false },
        { name: "get_workspace", mutates: false },
        { name: "get_generated_code", mutates: false },
        { name: "validate_workspace", mutates: false },
        { name: "get_terminal", mutates: false },
        { name: "get_settings", mutates: false },
        { name: "list_addons", mutates: false },
        { name: "apply_workspace_patch", mutates: true, supportsDryRun: true, supportsUndo: true },
        { name: "undo_workspace_patch", mutates: true }
      ],
      patchOperations: ["clear", "replace_xml", "create", "set_field", "connect_sequence", "connect_input", "move", "disconnect", "delete"]
    };
  }

  async function call(toolName, args) {
    const name = String(toolName || "");
    const input = args || {};
    switch (name) {
      case "get_capabilities": return capabilities();
      case "get_state": return getState();
      case "list_blocks": return Object.assign(queryToolboxBlocks(input), {
        locale: getLocale(),
        processor: getSettings().processor || null
      });
      case "describe_block": return describeBlockType(input.type);
      case "get_workspace": return getWorkspaceSnapshot();
      case "get_generated_code": return { revision, language: "python", code: getGeneratedCodeValue() };
      case "validate_workspace": return validateWorkspace();
      case "get_terminal": return getTerminalTail(input);
      case "get_settings": return getSettings();
      case "list_addons": return { addons: getAddons() };
      case "apply_workspace_patch": return applyWorkspacePatch(input);
      case "undo_workspace_patch": return undoWorkspacePatch(input);
      default: throw makeError("UNKNOWN_TOOL", "Unknown ESPIDE_AI tool: " + name);
    }
  }

  function createLegacyApi() {
    return {
      getWorkspace,
      getToolboxXmlText,
      listToolboxBlocks,
      findToolboxBlockTemplate,
      describeBlockType,
      createBlock,
      createBlockFromToolbox,
      getBlock,
      connectSequence,
      connectInput,
      loadXml,
      workspaceToXml,
      clearWorkspace
    };
  }

  function attachWorkspaceEvents() {
    const workspace = requireWorkspace();
    if (observedWorkspace && workspaceListener && typeof observedWorkspace.removeChangeListener === "function") {
      observedWorkspace.removeChangeListener(workspaceListener);
    }
    observedWorkspace = workspace;
    workspaceListener = function (event) {
      const isUiEvent = event && (event.isUiEvent || (Blockly.Events.isUiEvent && Blockly.Events.isUiEvent(event)));
      if (!event || transactionActive || isUiEvent) return;
      revision += 1;
      emit("workspace.changed", {
        eventType: event.type || null,
        blockId: event.blockId || null,
        blockCount: workspace.getAllBlocks(false).length
      });
    };
    workspace.addChangeListener(workspaceListener);
  }

  function initialize(options) {
    context = options || {};
    requireWorkspace();
    revision = Math.max(1, revision);
    attachWorkspaceEvents();
    wrapTerminal();
    initialized = true;
    global.__espideBlocklyAutomation = createLegacyApi();
    lastConnectionState = JSON.stringify(getConnectionState());
    const ready = { state: getState(), capabilities: capabilities() };
    emit("ready", ready);
    try { global.dispatchEvent(new CustomEvent("espide-ai-ready", { detail: ready })); } catch (_) {}
    return ready;
  }

  global.ESPIDE_AI = {
    version: API_VERSION,
    initialize,
    capabilities,
    call,
    subscribe,
    notifyConnectionChanged,
    notifyLocaleChanged,
    notifyToolboxChanged,
    captureTerminal,
    get revision() { return revision; },
    get initialized() { return initialized; }
  };
})(window);
