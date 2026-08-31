/**
 * ESP IDE display-target registry.
 *
 * Display add-ons register only their initialization block type and a resolver
 * returning the current display profile. The registry deliberately ignores
 * blocks that merely exist in the toolbox: only blocks instantiated in the
 * current Blockly workspace can become the active designer target.
 */
(function(root, factory) {
  "use strict";
  var api = factory(root || {});
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ESPIDE_DISPLAY_TARGETS = api;
})(typeof window !== "undefined" ? window : this, function(global) {
  "use strict";

  var DEFAULT_PROFILE = Object.freeze({
    profileId: "espide-mono-128x64",
    width: 128,
    height: 64,
    mode: "mono",
    label: "128×64",
    source: "default",
    blockId: null,
    blockType: null
  });
  var MAX_DIMENSION = 1024;
  var MAX_FRAMEBUFFER_BYTES = 0xffff;
  var DATA_MARKER = /(?:^|\n)@espide-display-target-used:(\d+)(?=\n|$)/g;
  var registrations = Object.create(null);
  var workspaceStates = typeof WeakMap === "function" ? new WeakMap() : null;
  var fallbackStates = Object.create(null);
  var nextUseOrder = 1;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stateFor(workspace) {
    if (!workspace) return {observed: false, listener: null};
    var state;
    if (workspaceStates) {
      state = workspaceStates.get(workspace);
      if (!state) {
        state = {observed: false, listener: null};
        workspaceStates.set(workspace, state);
      }
      return state;
    }
    var id = String(workspace.id || "main");
    if (!fallbackStates[id]) fallbackStates[id] = {observed: false, listener: null};
    return fallbackStates[id];
  }

  function integer(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  }

  function framebufferBytes(width, height) {
    return width * Math.ceil(height / 8);
  }

  function normalizeProfile(value, block) {
    value = value && typeof value === "object" ? value : {};
    var width = integer(value.width, DEFAULT_PROFILE.width);
    var height = integer(value.height, DEFAULT_PROFILE.height);
    if (width < 1 || height < 1 || width > MAX_DIMENSION ||
        height > MAX_DIMENSION || framebufferBytes(width, height) >
        MAX_FRAMEBUFFER_BYTES) {
      throw new RangeError("Display resolution is outside the supported range");
    }
    var blockType = block && block.type ? String(block.type) : null;
    var blockId = block && block.id ? String(block.id) : null;
    var profileId = typeof value.profileId === "string" && value.profileId ?
        value.profileId.substring(0, 100) :
        (blockType || "display") + "-" + width + "x" + height;
    return {
      profileId: profileId,
      width: width,
      height: height,
      mode: value.mode === "rgb" || value.mode === "tricolor" ? value.mode : "mono",
      label: typeof value.label === "string" && value.label.trim() ?
          value.label.trim().substring(0, 120) : width + "×" + height,
      rotation: integer(value.rotation, 0),
      source: block ? "workspace" : (value.source || "manual"),
      blockId: blockId,
      blockType: blockType
    };
  }

  function readUseOrder(block) {
    var source = String(block && block.data || "");
    var result = 0;
    var match;
    DATA_MARKER.lastIndex = 0;
    while ((match = DATA_MARKER.exec(source))) {
      result = Math.max(result, Number(match[1]) || 0);
    }
    nextUseOrder = Math.max(nextUseOrder, result + 1);
    return result;
  }

  function writeUseOrder(block, order) {
    if (!block) return;
    var source = String(block.data || "");
    DATA_MARKER.lastIndex = 0;
    source = source.replace(DATA_MARKER, "").replace(/^\n+|\n+$/g, "");
    block.data = (source ? source + "\n" : "") +
        "@espide-display-target-used:" + order;
  }

  function resolveBlock(block) {
    if (!block || !registrations[block.type]) return null;
    var registration = registrations[block.type];
    var value = registration.resolve(block);
    if (value === null || value === false || value === undefined) return null;
    return normalizeProfile(value, block);
  }

  function markUsed(block) {
    if (!resolveBlock(block)) return null;
    var order = nextUseOrder++;
    writeUseOrder(block, order);
    observeWorkspace(block.workspace);
    return order;
  }

  function onWorkspaceEvent(workspace, event) {
    if (!event || event.isUiEvent) return;
    var Blockly = global.Blockly;
    var createType = Blockly && Blockly.Events ? Blockly.Events.CREATE : "create";
    var changeType = Blockly && Blockly.Events ? Blockly.Events.CHANGE : "change";
    if (event.type !== createType && event.type !== changeType) return;
    var ids = Array.isArray(event.ids) ? event.ids : [event.blockId];
    for (var i = 0; i < ids.length; i++) {
      var block = ids[i] && workspace.getBlockById ? workspace.getBlockById(ids[i]) : null;
      if (block && registrations[block.type]) markUsed(block);
    }
  }

  function observeWorkspace(workspace) {
    if (!workspace || typeof workspace.addChangeListener !== "function") return workspace;
    var state = stateFor(workspace);
    if (state.observed) return workspace;
    state.observed = true;
    state.listener = function(event) { onWorkspaceEvent(workspace, event); };
    workspace.addChangeListener(state.listener);
    var blocks = typeof workspace.getAllBlocks === "function" ?
        workspace.getAllBlocks(false) : [];
    for (var i = 0; i < blocks.length; i++) readUseOrder(blocks[i]);
    return workspace;
  }

  function list(workspace) {
    observeWorkspace(workspace);
    if (!workspace || typeof workspace.getAllBlocks !== "function") return [];
    var blocks = workspace.getAllBlocks(false);
    var targets = [];
    for (var i = 0; i < blocks.length; i++) {
      var profile = resolveBlock(blocks[i]);
      if (!profile) continue;
      profile.useOrder = readUseOrder(blocks[i]);
      profile.workspaceOrder = i;
      targets.push(profile);
    }
    return targets;
  }

  function getActive(workspace) {
    var targets = list(workspace);
    if (!targets.length) return clone(DEFAULT_PROFILE);
    targets.sort(function(left, right) {
      if (left.useOrder !== right.useOrder) return left.useOrder - right.useOrder;
      return left.workspaceOrder - right.workspaceOrder;
    });
    var active = clone(targets[targets.length - 1]);
    delete active.useOrder;
    delete active.workspaceOrder;
    return active;
  }

  function register(blockType, resolver) {
    blockType = String(blockType || "").trim();
    if (!blockType) throw new TypeError("Display init block type is required");
    if (resolver && typeof resolver === "object") resolver = resolver.resolve;
    if (typeof resolver !== "function") {
      throw new TypeError("Display target resolver must be a function");
    }
    registrations[blockType] = {resolve: resolver};
    return function() { unregister(blockType); };
  }

  function unregister(blockType) {
    delete registrations[String(blockType || "")];
  }

  function openDesigner(sourceBlock, options) {
    options = options || {};
    var designer = global.ESPIDE_DISPLAY_DESIGNER;
    if (!designer || typeof designer.open !== "function") {
      throw new Error("Display Designer is unavailable");
    }
    var editorBlock = options.editorBlock || sourceBlock;
    var workspace = sourceBlock && sourceBlock.workspace ||
        editorBlock && editorBlock.workspace || null;
    var target = options.target ? normalizeProfile(options.target, null) :
        getActive(workspace);
    return designer.open(editorBlock, {target: target, sourceBlock: sourceBlock});
  }

  function designerButtonArtwork(label) {
    label = String(label || "Open graphic editor");
    var width = Math.max(168, Math.min(252, Array.from(label).length * 8 + 30));
    var escaped = label.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + width +
        '" height="30"><rect x=".5" y=".5" width="' + (width - 1) +
        '" height="29" rx="6" fill="#58206b" stroke="#fff" ' +
        'stroke-opacity=".72"/><text x="' + (width / 2) +
        '" y="19.5" text-anchor="middle" fill="#fff" ' +
        'font-family="Arial,sans-serif" font-size="13" font-weight="700">' +
        escaped + '</text></svg>';
    return {uri: "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg),
      width: width};
  }

  /**
   * Give a custom newblk block its own persistent designer scene and button.
   * Existing mutation handlers are chained and retain ownership of their data.
   */
  function attachDesigner(block, options) {
    options = options || {};
    if (!block || block.espideDisplayDesignerAttached_) return block;
    var Blockly = global.Blockly;
    if (!Blockly || !Blockly.FieldImage) {
      throw new Error("Blockly is unavailable");
    }
    block.espideDisplayDesignerAttached_ = true;
    var scene = options.scene || {
      schema: "espide.display-designer", version: 1, width: 128, height: 64,
      mode: "mono", name: options.sceneName || "Screen", layers: [], fonts: [],
      parameters: []
    };
    var oldMutationToDom = typeof block.mutationToDom === "function" ?
        block.mutationToDom : null;
    var oldDomToMutation = typeof block.domToMutation === "function" ?
        block.domToMutation : null;

    function normalizeScene(value) {
      var designer = global.ESPIDE_DISPLAY_DESIGNER;
      if (designer && typeof designer.normalizeScene === "function") {
        return designer.normalizeScene(value);
      }
      try {
        return clone(value || scene);
      } catch (error) {
        return clone(scene);
      }
    }

    scene = normalizeScene(scene);
    block.getDisplayDesignerScene = function() { return normalizeScene(scene); };
    block.setDisplayDesignerScene = function(value, recordEvent) {
      var before = "";
      if (recordEvent !== false && Blockly.Events && Blockly.Events.isEnabled()) {
        before = Blockly.Xml.domToText(block.mutationToDom());
      }
      scene = normalizeScene(value);
      if (recordEvent !== false && Blockly.Events && Blockly.Events.isEnabled()) {
        var after = Blockly.Xml.domToText(block.mutationToDom());
        if (before !== after) {
          Blockly.Events.fire(new Blockly.Events.BlockChange(
              block, "mutation", null, before, after));
        }
      }
      if (typeof options.onSceneChange === "function") options.onSceneChange(scene, block);
    };
    block.mutationToDom = function() {
      var container = oldMutationToDom ? oldMutationToDom.call(block) : null;
      if (!container) container = global.document.createElement("mutation");
      container.setAttribute("espide_display_scene_version", "1");
      container.setAttribute("espide_display_scene", JSON.stringify(scene));
      return container;
    };
    block.domToMutation = function(xmlElement) {
      if (oldDomToMutation) oldDomToMutation.call(block, xmlElement);
      try {
        var stored = xmlElement.getAttribute("espide_display_scene");
        if (stored) scene = normalizeScene(JSON.parse(stored));
      } catch (error) {
        if (global.console && global.console.warn) {
          global.console.warn("ESP IDE: invalid add-on display scene", error);
        }
      }
    };

    if (options.button !== false) {
      var label = options.buttonLabel || "Open graphic editor";
      var artwork = designerButtonArtwork(label);
      block.appendDummyInput(options.inputName || "ESPIDE_DISPLAY_DESIGNER_ACTION")
          .appendField(new Blockly.FieldImage(
              artwork.uri, artwork.width, 30, label,
              function() { openDesigner(block); }));
    }
    return block;
  }

  /* Built-in OLED initialization blocks remain ordinary registered targets.
   * Add-ons use the exact same public API and therefore need no IDE patch. */
  register("oled_init", function() { return DEFAULT_PROFILE; });
  register("oled_init_hw", function() { return DEFAULT_PROFILE; });

  return Object.freeze({
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    MAX_DIMENSION: MAX_DIMENSION,
    MAX_FRAMEBUFFER_BYTES: MAX_FRAMEBUFFER_BYTES,
    framebufferBytes: framebufferBytes,
    normalizeProfile: normalizeProfile,
    register: register,
    unregister: unregister,
    resolveBlock: resolveBlock,
    observeWorkspace: observeWorkspace,
    markUsed: markUsed,
    list: list,
    getActive: getActive,
    openDesigner: openDesigner,
    attachDesigner: attachDesigner
  });
});
