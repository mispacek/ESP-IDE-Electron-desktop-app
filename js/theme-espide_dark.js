ace.define("ace/theme/espide_dark", ["require", "exports", "module", "ace/lib/dom"], function(require, exports, module) {
  exports.isDark = true;
  exports.cssClass = "ace-espide-dark";
  exports.cssText = "\
.ace-espide-dark .ace_gutter {\
background: #1e1e1e;\
color: #858585;\
border-right: 1px solid #2d2d30;\
}\
.ace-espide-dark .ace_print-margin {\
width: 1px;\
background: #2d2d30;\
}\
.ace-espide-dark {\
background-color: #1e1e1e;\
color: #d4d4d4;\
}\
.ace-espide-dark .ace_cursor {\
color: #aeafad;\
}\
.ace-espide-dark .ace_marker-layer .ace_selection {\
background: #264f78;\
}\
.ace-espide-dark.ace_multiselect .ace_selection.ace_start {\
box-shadow: 0 0 3px 0px #1e1e1e;\
border-radius: 2px;\
}\
.ace-espide-dark .ace_marker-layer .ace_step {\
background: rgb(102, 82, 0);\
}\
.ace-espide-dark .ace_marker-layer .ace_bracket {\
margin: -1px 0 0 -1px;\
border: 1px solid #4d4d4d;\
}\
.ace-espide-dark .ace_marker-layer .ace_active-line {\
background: #282828;\
}\
.ace-espide-dark .ace_gutter-active-line {\
background-color: #2d2d30;\
}\
.ace-espide-dark .ace_marker-layer .ace_selected-word {\
border: 1px solid #4d4d4d;\
}\
.ace-espide-dark .ace_invisible {\
color: #4d4d4d;\
}\
.ace-espide-dark .ace_keyword,\
.ace-espide-dark .ace_meta,\
.ace-espide-dark .ace_storage,\
.ace-espide-dark .ace_storage.ace_type,\
.ace-espide-dark .ace_support.ace_type {\
color: #569cd6;\
}\
.ace-espide-dark .ace_keyword.ace_operator {\
color: #d4d4d4;\
}\
.ace-espide-dark .ace_constant.ace_character,\
.ace-espide-dark .ace_constant.ace_language,\
.ace-espide-dark .ace_constant.ace_numeric,\
.ace-espide-dark .ace_keyword.ace_other.ace_unit,\
.ace-espide-dark .ace_support.ace_constant,\
.ace-espide-dark .ace_variable.ace_parameter {\
color: #b5cea8;\
}\
.ace-espide-dark .ace_constant.ace_other {\
color: #d4d4d4;\
}\
.ace-espide-dark .ace_invalid {\
color: #f44747;\
}\
.ace-espide-dark .ace_invalid.ace_deprecated {\
color: #f44747;\
}\
.ace-espide-dark .ace_fold {\
background-color: #569cd6;\
border-color: #d4d4d4;\
}\
.ace-espide-dark .ace_entity.ace_name.ace_function,\
.ace-espide-dark .ace_support.ace_function {\
color: #dcdcaa;\
}\
.ace-espide-dark .ace_support.ace_class,\
.ace-espide-dark .ace_support.ace_type {\
color: #4ec9b0;\
}\
.ace-espide-dark .ace_heading,\
.ace-espide-dark .ace_markup.ace_heading,\
.ace-espide-dark .ace_string {\
color: #ce9178;\
}\
.ace-espide-dark .ace_entity.ace_name.ace_tag,\
.ace-espide-dark .ace_entity.ace_other.ace_attribute-name,\
.ace-espide-dark .ace_meta.ace_tag,\
.ace-espide-dark .ace_string.ace_regexp,\
.ace-espide-dark .ace_variable {\
color: #9cdcfe;\
}\
.ace-espide-dark .ace_comment {\
color: #6a9955;\
font-style: italic;\
}\
.ace-espide-dark .ace_indent-guide {\
background: url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGBgYHB3d/8PAAOIAdULw8qMAAAAAElFTkSuQmCC) right repeat-y;\
}\
";

  var dom = require("../lib/dom");
  dom.importCssString(exports.cssText, exports.cssClass);
});
