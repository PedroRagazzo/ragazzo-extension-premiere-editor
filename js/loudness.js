// Nivelar voz: mede o volume médio (dB, via o filtro volumedetect do ffmpeg —
// não LUFS/loudnorm) em várias JANELAS ao longo de cada clipe de áudio
// selecionado e devolve uma curva de ganho (uma keyframe por janela) que o
// painel escreve no parâmetro Nível do Premiere. Nivelar de verdade é isso:
// o ganho varia ponto a ponto pra compensar trechos mais baixos e mais altos
// — um valor único fixo pro clipe inteiro (o que este arquivo fazia antes)
// só corrige a média, não "achata" a variação real do áudio.
//
// A lógica pura (computeWindowPlan / computeGainForMeanVolume) não depende
// de Node nem do CEP — dá pra testar isolada com `node` puro, no mesmo
// espírito de silence-cut.js.

(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  }
  if (typeof window !== "undefined") {
    window.Loudness = mod;
  }
})(this, function () {
  var FFMPEG_CANDIDATES = [
    "ffmpeg",
    "C:\\Users\\Ragazzo\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"
  ];

  // O parâmetro "Nível" do efeito Volume (fixo, nativo do Premiere) tem um
  // teto rígido de +15dB — é uma limitação da própria ferramenta (não deste
  // código): setValue() acima disso é silenciosamente recortado pelo
  // Premiere pra 15, pra qualquer keyframe. Pro lado negativo o Premiere
  // aceita valores bem baixos (na prática, perto de silêncio) — o piso aqui
  // é só uma proteção contra leitura absurda do ffmpeg, não uma limitação
  // real do parâmetro.
  var LEVEL_MAX_DB = 15;
  var LEVEL_MIN_DB = -96;

  // ---------- lógica pura (testável sem ffmpeg/CEP) ----------

  // Divide durationSec em janelas de ~windowSec cada. A última janela, se
  // sobrar menos de 30% do tamanho normal, é fundida na anterior em vez de
  // virar uma fatia minúscula (evita uma keyframe quase colada na anterior).
  function computeWindowPlan(durationSec, windowSec) {
    var windows = [];
    if (durationSec <= 0 || windowSec <= 0) return windows;

    var offset = 0;
    while (offset < durationSec) {
      var remaining = durationSec - offset;
      var len = Math.min(windowSec, remaining);
      if (windows.length > 0 && remaining < windowSec * 0.3) {
        windows[windows.length - 1].length += remaining;
        break;
      }
      windows.push({ offset: offset, length: len });
      offset += len;
    }
    return windows;
  }

  // targetDb: alvo desejado (dB)  meanVolumeDb: volume médio medido da janela (dB)
  function computeGainForMeanVolume(targetDb, meanVolumeDb) {
    var gain = targetDb - meanVolumeDb;
    var clamped = Math.max(LEVEL_MIN_DB, Math.min(LEVEL_MAX_DB, gain));
    return { gainDb: clamped, rawGainDb: gain, clamped: clamped !== gain };
  }

  // ---------- execução (Node/ffmpeg) ----------

  function measureWindowVolume(filePath, startSec, durationSec, cb) {
    var cp;
    try {
      cp = require("child_process");
    } catch (e) {
      cb(new Error("Node.js não está disponível neste painel."));
      return;
    }

    var attempt = 0;
    function tryNext() {
      if (attempt >= FFMPEG_CANDIDATES.length) {
        cb(new Error("ffmpeg não encontrado."));
        return;
      }
      var bin = FFMPEG_CANDIDATES[attempt++];
      var args = ["-ss", String(startSec), "-i", filePath, "-t", String(durationSec),
        "-af", "volumedetect", "-f", "null", "-"];
      cp.execFile(bin, args, { maxBuffer: 1024 * 1024 * 20 }, function (err, stdout, stderr) {
        var out = (stderr || "") + (stdout || "");
        var m = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(out);
        if (m) {
          cb(null, parseFloat(m[1]));
          return;
        }
        if (err && attempt < FFMPEG_CANDIDATES.length) {
          tryNext();
        } else {
          cb(new Error("Não foi possível medir o volume (ffmpeg indisponível ou arquivo inválido)."));
        }
      });
    }
    tryNext();
  }

  // item: {index, path, start, end, sourceIn}  targetDb: number  windowSec: number
  // onWindowProgress(winDone, winTotal)
  // cb(err, {keys: [{t, gainDb}], windows: [{offset, length, meanVolumeDb, gainDb, rawGainDb, clamped}]})
  function planClipLeveling(item, targetDb, windowSec, onWindowProgress, cb) {
    var duration = item.end - item.start;
    var plan = computeWindowPlan(duration, windowSec);
    if (plan.length === 0) {
      cb(null, { keys: [], windows: [] });
      return;
    }

    var windows = [];
    var i = 0;
    function next() {
      if (i >= plan.length) {
        var keys = windows.map(function (w) {
          return { t: item.start + w.offset + w.length / 2, gainDb: w.gainDb };
        });
        cb(null, { keys: keys, windows: windows });
        return;
      }
      var w = plan[i];
      if (onWindowProgress) onWindowProgress(i + 1, plan.length);
      var srcStart = (item.sourceIn || 0) + w.offset;
      measureWindowVolume(item.path, srcStart, w.length, function (err, meanVolumeDb) {
        if (!err && meanVolumeDb !== null && !isNaN(meanVolumeDb)) {
          var g = computeGainForMeanVolume(targetDb, meanVolumeDb);
          windows.push({
            offset: w.offset, length: w.length, meanVolumeDb: meanVolumeDb,
            gainDb: g.gainDb, rawGainDb: g.rawGainDb, clamped: g.clamped
          });
        }
        // janela ilegível: pula sem travar o nivelamento inteiro por causa
        // de um trecho só (silêncio total costuma não reportar mean_volume).
        i++;
        next();
      });
    }
    next();
  }

  // items: [{index, path, start, end, sourceIn}]
  // onProgress(clipDone, clipTotal, winDone, winTotal)
  // callback([{index, keys, windows}])
  function planLeveling(items, targetDb, windowSec, onProgress, callback) {
    var results = [];
    var i = 0;

    function next() {
      if (i >= items.length) {
        callback(results);
        return;
      }
      var item = items[i];
      if (!item.path) {
        results.push({ index: item.index, keys: [], windows: [] });
        i++;
        next();
        return;
      }
      planClipLeveling(item, targetDb, windowSec, function (winDone, winTotal) {
        if (onProgress) onProgress(i + 1, items.length, winDone, winTotal);
      }, function (err, plan) {
        results.push({ index: item.index, keys: plan.keys, windows: plan.windows });
        i++;
        next();
      });
    }

    next();
  }

  return {
    computeWindowPlan: computeWindowPlan,
    computeGainForMeanVolume: computeGainForMeanVolume,
    planLeveling: planLeveling,
    LEVEL_MAX_DB: LEVEL_MAX_DB,
    LEVEL_MIN_DB: LEVEL_MIN_DB
  };
});
