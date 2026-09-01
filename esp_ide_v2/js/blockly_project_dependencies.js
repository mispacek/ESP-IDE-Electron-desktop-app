"use strict";

(function(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ESPIDE_BLOCKLY_PROJECT_DEPENDENCIES = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  function normalizeName(value) {
    return String(value || "").trim();
  }

  function normalizeType(value) {
    return String(value || "").trim();
  }

  function collectWorkspaceBlockTypes(workspace) {
    if (!workspace || typeof workspace.getAllBlocks !== "function") {
      throw new Error("Blockly workspace is unavailable.");
    }
    const types = new Set();
    for (const block of workspace.getAllBlocks(false) || []) {
      const type = normalizeType(block && block.type);
      if (type) types.add(type);
    }
    return types;
  }

  function collectDeclaredBlockTypes(xmlText, DOMParserCtor) {
    const types = new Set();
    if (!xmlText || typeof xmlText !== "string" || !DOMParserCtor) return types;

    const fragment = xmlText
      .replace(/^\s*<xml(?:\s[^>]*)?>/i, "")
      .replace(/<\/xml>\s*$/i, "");
    const parser = new DOMParserCtor();
    const doc = parser.parseFromString("<xml>" + fragment + "</xml>", "text/xml");
    if (doc.getElementsByTagName("parsererror").length) {
      throw new Error("Invalid add-on toolbox XML.");
    }
    for (const node of Array.from(doc.querySelectorAll("block[type], shadow[type]"))) {
      const type = normalizeType(node.getAttribute("type"));
      if (type) types.add(type);
    }
    return types;
  }

  function createResolutionError(code, message, details) {
    const error = new Error(message);
    error.name = "BlocklyProjectDependencyError";
    error.code = code;
    Object.assign(error, details || {});
    return error;
  }

  function createRegistry() {
    const coreBlockTypes = new Set();
    const runtimeTypesByExtension = new Map();
    let coreCaptured = false;
    let captureHealthy = true;
    let captureFailure = "";
    let integrationValid = true;
    let integrationFailure = "";

    function captureCore(blockly) {
      if (coreCaptured) return;
      if (!blockly || !blockly.Blocks) {
        throw new Error("Blockly block registry is unavailable.");
      }
      for (const type of Object.keys(blockly.Blocks)) {
        const normalized = normalizeType(type);
        if (normalized) coreBlockTypes.add(normalized);
      }
      coreCaptured = true;
    }

    function markUnreliable(reason) {
      captureHealthy = false;
      captureFailure = String(reason && reason.message || reason || "Unknown registration tracking error.");
    }

    function beginIntegration() {
      integrationValid = true;
      integrationFailure = "";
    }

    function markInvalid(reason) {
      integrationValid = false;
      integrationFailure = String(reason && reason.message || reason || "Unknown add-on integration error.");
    }

    function recordRuntimeType(extensionName, type) {
      const owner = normalizeName(extensionName);
      const normalizedType = normalizeType(type);
      if (!owner || !normalizedType) return;
      if (!runtimeTypesByExtension.has(owner)) {
        runtimeTypesByExtension.set(owner, new Set());
      }
      runtimeTypesByExtension.get(owner).add(normalizedType);
    }

    function trackRegistrations(blockly, runner) {
      captureCore(blockly);
      if (typeof Proxy !== "function") {
        markUnreliable("JavaScript Proxy is unavailable.");
        return runner(function() {});
      }

      let activeExtension = "";
      const preparedExtensions = new Set();
      const replacements = [];
      const proxiesByTarget = new Map();
      const registryKeys = ["Blocks", "Python", "MicroPython", "Micropython"];

      function proxyFor(target) {
        if (proxiesByTarget.has(target)) return proxiesByTarget.get(target);
        const proxy = new Proxy(target, {
          set(object, property, value) {
            recordRuntimeType(activeExtension, property);
            return Reflect.set(object, property, value);
          },
          defineProperty(object, property, descriptor) {
            recordRuntimeType(activeExtension, property);
            return Reflect.defineProperty(object, property, descriptor);
          },
          deleteProperty(object, property) {
            recordRuntimeType(activeExtension, property);
            return Reflect.deleteProperty(object, property);
          }
        });
        proxiesByTarget.set(target, proxy);
        return proxy;
      }

      try {
        for (const key of registryKeys) {
          const target = blockly && blockly[key];
          if (!target || (typeof target !== "object" && typeof target !== "function")) continue;
          replacements.push({ key, target });
          blockly[key] = proxyFor(target);
        }
        return runner(function(extensionName) {
          const owner = normalizeName(extensionName);
          if (owner && !preparedExtensions.has(owner)) {
            // A reinstalled or updated add-on must not retain block ownership
            // that came only from its previous source.
            runtimeTypesByExtension.set(owner, new Set());
            preparedExtensions.add(owner);
          }
          activeExtension = owner;
        });
      } catch (error) {
        markUnreliable(error);
        throw error;
      } finally {
        activeExtension = "";
        for (let index = replacements.length - 1; index >= 0; index--) {
          const item = replacements[index];
          blockly[item.key] = item.target;
        }
      }
    }

    function buildOwnerIndex(extensionRecords, DOMParserCtor) {
      const ownersByType = new Map();

      function addOwner(type, owner) {
        const normalizedType = normalizeType(type);
        const normalizedOwner = normalizeName(owner);
        if (!normalizedType || !normalizedOwner) return;
        if (!ownersByType.has(normalizedType)) {
          ownersByType.set(normalizedType, new Set());
        }
        ownersByType.get(normalizedType).add(normalizedOwner);
      }

      for (const [owner, types] of runtimeTypesByExtension.entries()) {
        for (const type of types) addOwner(type, owner);
      }

      const records = extensionRecords && typeof extensionRecords === "object"
        ? extensionRecords
        : {};
      for (const owner of Object.keys(records)) {
        const record = records[owner] || {};
        let declaredTypes;
        try {
          declaredTypes = collectDeclaredBlockTypes(record.xml || "", DOMParserCtor);
        } catch (_) {
          continue;
        }
        const runtimeTypes = runtimeTypesByExtension.get(owner) || new Set();
        for (const type of declaredTypes) {
          // Built-in shadow/value blocks in an add-on toolbox are not add-on
          // dependencies unless the add-on actually registered that type.
          if (!coreBlockTypes.has(type) || runtimeTypes.has(type)) {
            addOwner(type, owner);
          }
        }
      }
      return ownersByType;
    }

    function resolve(workspace, extensionRecords, DOMParserCtor) {
      if (!coreCaptured) {
        throw createResolutionError(
          "REGISTRY_NOT_READY",
          "Blockly dependency registry is not ready."
        );
      }
      if (!integrationValid) {
        throw createResolutionError(
          "EXTENSION_INTEGRATION_FAILED",
          "An add-on failed during integration.",
          { integrationFailure }
        );
      }

      const records = extensionRecords && typeof extensionRecords === "object"
        ? extensionRecords
        : {};
      const usedTypes = collectWorkspaceBlockTypes(workspace);
      const ownersByType = buildOwnerIndex(records, DOMParserCtor);
      const selectedNames = new Set();
      const unresolvedTypes = [];
      const missingOwners = new Map();

      for (const type of usedTypes) {
        const owners = ownersByType.get(type);
        if (owners && owners.size) {
          for (const owner of owners) {
            const record = records[owner];
            if (!record || typeof record.js !== "string" || !record.js.trim()) {
              if (!missingOwners.has(owner)) missingOwners.set(owner, []);
              missingOwners.get(owner).push(type);
            } else {
              selectedNames.add(owner);
            }
          }
          continue;
        }
        if (!coreBlockTypes.has(type)) unresolvedTypes.push(type);
      }

      if (missingOwners.size) {
        const missing = Array.from(missingOwners, ([name, types]) => ({ name, types }));
        throw createResolutionError(
          "MISSING_EXTENSION_SOURCE",
          "A project add-on is no longer available.",
          { missing }
        );
      }
      if (unresolvedTypes.length) {
        throw createResolutionError(
          "UNRESOLVED_BLOCK_TYPES",
          "Some project block types have no known add-on source.",
          { types: unresolvedTypes }
        );
      }

      // A failed tracker cannot prove that an add-on did not override a core
      // generator. Keeping all available records is the safe fallback.
      if (!captureHealthy) {
        for (const name of Object.keys(records)) {
          const record = records[name];
          if (record && typeof record.js === "string" && record.js.trim()) {
            selectedNames.add(name);
          }
        }
      }

      return {
        names: Object.keys(records).filter(name => selectedNames.has(name)),
        usedTypes: Array.from(usedTypes),
        conservative: !captureHealthy,
        captureFailure
      };
    }

    function findUsedTypesForExtension(workspace, extensionName, extensionRecords, DOMParserCtor) {
      if (!coreCaptured) return [];
      if (!integrationValid) {
        throw createResolutionError(
          "EXTENSION_INTEGRATION_FAILED",
          "An add-on failed during integration.",
          { integrationFailure }
        );
      }
      if (!captureHealthy) {
        throw createResolutionError(
          "REGISTRY_NOT_READY",
          "Blockly dependency tracking is using a conservative fallback."
        );
      }
      const owner = normalizeName(extensionName);
      const usedTypes = collectWorkspaceBlockTypes(workspace);
      const ownersByType = buildOwnerIndex(extensionRecords, DOMParserCtor);
      return Array.from(usedTypes).filter(type => {
        const owners = ownersByType.get(type);
        return owners && owners.has(owner);
      });
    }

    return {
      captureCore,
      beginIntegration,
      findUsedTypesForExtension,
      markInvalid,
      markUnreliable,
      resolve,
      trackRegistrations,
      getStatus: function() {
        return {
          coreCaptured,
          captureHealthy,
          captureFailure,
          integrationValid,
          integrationFailure,
          coreBlockTypes: Array.from(coreBlockTypes)
        };
      }
    };
  }

  return {
    collectDeclaredBlockTypes,
    collectWorkspaceBlockTypes,
    createRegistry
  };
});
