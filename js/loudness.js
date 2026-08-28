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

  // items: [{index, path}]  targetLufs: number
  // callback(gainsArray) onde gainsArray = [{index, gainDb}]
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
          gain = Math.max(-24, Math.min(24, gain));
          results.push({ index: item.index, gainDb: gain });
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
