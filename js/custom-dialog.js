// custom-dialog.js  (načítat po Blockly, viz bod 1)
(function () {
  /** Čekej, až bude Blockly připravené *****************************************************/
  function whenReady(cb) {
    if (window.Blockly && (Blockly.dialog || Blockly.alert)) cb();
    else setTimeout(()=>whenReady(cb), 30);               // zkus znovu za 30 ms
  }

  whenReady(()=> {
    /* ---------- Fallback, pokud preload ještě nevytvořil window.dlg ---------- */
    if (!window.dlg) {
      window.dlg = {};
    }
    if (typeof window.dlg.message !== 'function') {
      window.dlg.message = (opts) => {
        return Swal.fire({
          icon:  opts.type === 'question' ? 'question' : 'info',
          title:  opts.message,
          showCancelButton: (opts.buttons || []).length > 1,
          confirmButtonText: (opts.buttons || ['OK'])[0],
          cancelButtonText:  (opts.buttons || [''])[1] || undefined
        }).then(r => ({ response: r.isConfirmed ? 0 : 1 }));
      };
    }
    
    
    /* --------- Funkce využívající nativní dialogy Electronu ---------------------------- */
    const dlgAlert = (msg, cb)=>
      window.dlg.message({type:'info',buttons:['OK'],message:msg}).then(()=>cb&&cb());

    const dlgConfirm = (msg, cb)=>
      window.dlg.message({
        type:'question',buttons:['Ano','Ne'],defaultId:0,cancelId:1,message:msg
      }).then(r=>cb(r.response===0));

    const dlgPrompt = (msg, def, cb)=>
      Swal.fire({input:'text',inputValue:def||'',title:msg,
                 showCancelButton:true,confirmButtonText:'OK',cancelButtonText:'Zrušit'
      }).then(r=>cb(r.isConfirmed ? r.value : null));

    /* --------- Registrace podle toho, co prostředí nabízí ------------------------------ */
    if (Blockly.dialog && Blockly.dialog.setAlert) {      // Blockly 6.2+
      Blockly.dialog.setAlert  (dlgAlert);
      Blockly.dialog.setConfirm(dlgConfirm);
      Blockly.dialog.setPrompt (dlgPrompt);
    } else {                                              // starší verze
      Blockly.alert  = dlgAlert;
      Blockly.confirm= dlgConfirm;
      Blockly.prompt = dlgPrompt;
    }
  });
})();
