// Mede o loudness integrado (LUFS) de um arquivo de áudio usando ffmpeg (filtro loudnorm),
// exigindo Node.js habilitado no manifesto do painel (--enable-nodejs / --mixed-context).

(function (global) {
  var FFMPEG_CANDIDATES = [
    "ffmpeg",
    "C:\\Users\\Ragazzo\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"
  ];

  function measureOne(filePath, callback) {
    var cp;
    try {
      cp = require("child_process");
    } catch (e) {
      callback(new Error("Node.js não está disponível neste painel."));
      return;
    }

    var attempt = 0;

    function tryNext() {
      if (attempt >= FFMPEG_CANDIDATES.length) {
        callback(new Error("ffmpeg não encontrado."));
        return;
      }
      var bin = FFMPEG_CANDIDATES[attempt++];
      var args = ["-hide_banner", "-i", filePath, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"];

      cp.execFile(bin, args, { maxBuffer: 1024 * 1024 * 20 }, function (err, stdout, stderr) {
        var out = (stderr || "") + (stdout || "");
        var match = out.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
        if (match) {
          try {
            var stats = JSON.parse(match[0]);
            callback(null, parseFloat(stats.input_i));
            return;
          } catch (e2) {
            // segue para próxima tentativa / erro
          }
        }
        if (err && attempt < FFMPEG_CANDIDATES.length) {
          tryNext();
        } else {
          callback(new Error("Não foi possível medir o loudness (ffmpeg indisponível ou arquivo inválido)."));
        }
      });
    }

    tryNext();
  }

  // O parâmetro "Nível" do efeito Volume (fixo, nativo do Premiere) tem um
  // teto rígido de +15dB — é uma limitação da própria ferramenta (não do
  // nosso código): setValue() acima disso é silenciosamente recortado pelo
  // Premiere pra 15. Sem essa constante, um clipe muito baixo (que matematicamente
  // precisaria de +20, +30dB pra alcançar o alvo) sempre terminava em "15dB
  // cravado", não importa o alvo pedido — o que parecia bug mas era o nosso
  // próprio clamp (±24, alto demais) deixando o Premiere fazer o corte real.
  // Pro lado negativo o Premiere aceita valores bem baixos (na prática, perto
  // de silêncio) — o piso aqui é só uma proteção contra leitura absurda do
  // ffmpeg, não uma limitação real do parâmetro.
  var LEVEL_MAX_DB = 15;
  var LEVEL_MIN_DB = -96;

  // items: [{index, path}]  targetLufs: number
  // callback(gainsArray) onde gainsArray = [{index, gainDb, rawGainDb, clamped}]
  function measureAndComputeGains(items, targetLufs, onProgress, callback) {
    var results = [];
    var i = 0;

    function next() {
      if (i >= items.length) {
        callback(results);
        return;
      }
      var item = items[i];
      if (!item.path) {
        results.push({ index: item.index, gainDb: null });
        i++;
        next();
        return;
      }
      if (onProgress) onProgress(i + 1, items.length);
      measureOne(item.path, function (err, lufs) {
        if (err || lufs === null || isNaN(lufs)) {
          results.push({ index: item.index, gainDb: null });
        } else {
          var gain = targetLufs - lufs;
          var clampedGain = Math.max(LEVEL_MIN_DB, Math.min(LEVEL_MAX_DB, gain));
          results.push({
            index: item.index,
            gainDb: clampedGain,
            rawGainDb: gain,
            clamped: clampedGain !== gain
          });
        }
        i++;
        next();
      });
    }

    next();
  }

  global.Loudness = {
    measureAndComputeGains: measureAndComputeGains
  };
})(window);
