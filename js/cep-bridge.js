// Ponte mínima e original para comunicação com o host (Premiere Pro) via CEP.
// Cobre apenas o que este painel usa: executar ExtendScript e ler o tema do app.

(function (global) {
  function CepBridge() {
    this.csEvent = null;
  }

  CepBridge.prototype._csx = function () {
    return global.__adobe_cep__;
  };

  CepBridge.prototype.evalScript = function (script, callback) {
    var csx = this._csx();
    if (!csx) {
      if (callback) callback("erro: ambiente CEP não encontrado (abra dentro do Premiere)");
      return;
    }
    csx.evalScript(script, function (result) {
      if (callback) callback(result);
    });
  };

  CepBridge.prototype.getHostEnvironment = function () {
    var csx = this._csx();
    if (!csx) return null;
    try {
      return JSON.parse(csx.getHostEnvironment());
    } catch (e) {
      return null;
    }
  };

  global.CepBridge = new CepBridge();
})(window);
