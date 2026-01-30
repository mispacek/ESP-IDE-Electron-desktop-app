ace.define("ace/theme/espide_dark", ["require", "exports", "module", "ace/lib/dom"], function(require, exports, module) {
  exports.isDark = true;
  exports.cssClass = "ace-espide-dark";
  exports.cssText = "\
.ace-espide-dark .ace_gutter {\
background: #11161d;\
color: #7d8590;\
}\
.ace-espide-dark .ace_print-margin {\
width: 1px;\
background: #1f2630;\
}\
.ace-espide-dark {\
background-color: #0b0f14;\
color: #e6edf3;\
}\
.ace-espide-dark .ace_cursor {\
color: #e6edf3;\
}\
.ace-espide-dark .ace_marker-layer .ace_selection {\
background: #1e2632;\
}\
.ace-espide-dark.ace_multiselect .ace_selection.ace_start {\
box-shadow: 0 0 3px 0px #0b0f14;\
border-radius: 2px;\
}\
.ace-espide-dark .ace_marker-layer .ace_step {\
background: #2a3340;\
}\
.ace-espide-dark .ace_marker-layer .ace_bracket {\
margin: -1px 0 0 -1px;\
border: 1px solid #2a3340;\
}\
.ace-espide-dark .ace_marker-layer .ace_active-line {\
background: #141b24;\
}\
.ace-espide-dark .ace_gutter-active-line {\
background-color: #141b24;\
}\
.ace-espide-dark .ace_marker-layer .ace_selected-word {\
border: 1px solid #2a3340;\
}\
.ace-espide-dark .ace_invisible {\
color: #3a414c;\
}\
.ace-espide-dark .ace_keyword,\
.ace-espide-dark .ace_meta,\
.ace-espide-dark .ace_storage,\
.ace-espide-dark .ace_storage.ace_type {\
color: #7aa2f7;\
}\
.ace-espide-dark .ace_constant.ace_character,\
.ace-espide-dark .ace_constant.ace_language,\
.ace-espide-dark .ace_constant.ace_numeric,\
.ace-espide-dark .ace_constant.ace_other {\
color: #f78c6c;\
}\
.ace-espide-dark .ace_invalid {\
color: #ffffff;\
background-color: #d84c4c;\
}\
.ace-espide-dark .ace_support.ace_function {\
color: #6ee7b7;\
}\
.ace-espide-dark .ace_string {\
color: #a7d379;\
}\
.ace-espide-dark .ace_comment {\
color: #7d8590;\
font-style: italic;\
}\
.ace-espide-dark .ace_variable {\
color: #e6edf3;\
}\
.ace-espide-dark .ace_variable.ace_parameter {\
color: #9db7ff;\
}\
.ace-espide-dark .ace_entity.ace_name.ace_function {\
color: #6ea8ff;\
}\
.ace-espide-dark .ace_indent-guide {\
background: linear-gradient(to right, transparent 50%, #1f2630 50%);\
background-size: 2px 100%;\
}\
";

  var dom = require("../lib/dom");
  dom.importCssString(exports.cssText, exports.cssClass);
});
