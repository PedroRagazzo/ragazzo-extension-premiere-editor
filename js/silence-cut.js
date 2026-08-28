// Corte automático de silêncio/pausas: detecta trechos silenciosos com o filtro
// silencedetect do ffmpeg e gera um novo arquivo só com os trechos de fala (com uma
// pequena folga em volta de cada corte para não engolir o início/fim das palavras).
//
// As funções puras (parseSilenceLines / computeKeepSegments / buildCutArgs) não dependem
// de Node nem do CEP — dá pra testá-las isoladas com `node` puro.

(function (root, factory) {
  var mod = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = mod;
  }
  if (typeof window !== "undefined") {
    window.SilenceCut = mod;
  }
})(this, function () {
  var FFMPEG_CANDIDATES = ["ffmpeg", "C:\\Users\\Ragazzo\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffmpeg.exe"];
  var FFPROBE_CANDIDATES = ["ffprobe", "C:\\Users\\Ragazzo\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe"];
  var MAX_SEGMENTS = 400;

  // ---------- lógica pura (testável sem ffmpeg/CEP) ----------

  // stderrText: saída do ffmpeg com o filtro silencedetect
  // rangeStart/rangeEnd: janela absoluta (segundos) analisada, pra fechar o último trecho
  // Retorna [{start, end}] em segundos absolutos.
  function parseSilenceLines(stderrText, rangeStart, rangeEnd) {
    var silences = [];
    var pendingStart = null;
    var re = /silence_(start|end):\s*(-?[\d.]+)/g;
    var m;
    while ((m = re.exec(stderrText)) !== null) {
      var kind = m[1];
      var value = parseFloat(m[2]) + rangeStart;
      if (kind === "start") {
        pendingStart = value;
      } else if (kind === "end" && pendingStart !== null) {
        silences.push({ start: pendingStart, end: value });
        pendingStart = null;
      }
    }
    if (pendingStart !== null) {
      silences.push({ start: pendingStart, end: rangeEnd });
    }
    return silences;
  }

  // silences: [{start,end}] absolutos. Retorna os trechos de FALA a manter, encolhendo
  // cada silêncio por `paddingSec` de cada lado (silêncios menores que 2×padding são ignorados,
  // ou seja, não cortados — evita segmentos de duração negativa/zero).
  function computeKeepSegments(silences, rangeStart, rangeEnd, paddingSec) {
    var sorted = silences.slice().sort(function (a, b) { return a.start - b.start; });
    var cuts = [];
    for (var i = 0; i < sorted.length; i++) {
      var s = Math.max(rangeStart, sorted[i].start + paddingSec);
      var e = Math.min(rangeEnd, sorted[i].end - paddingSec);
      if (e > s) cuts.push({ start: s, end: e });
    }

    var keep = [];
    var cursor = rangeStart;
    for (var j = 0; j < cuts.length; j++) {
      if (cuts[j].start > cursor) keep.push({ start: cursor, end: cuts[j].start });
      cursor = Math.max(cursor, cuts[j].end);
    }
    if (rangeEnd > cursor) keep.push({ start: cursor, end: rangeEnd });

    return keep.filter(function (seg) { return seg.end - seg.start > 0.02; });
  }

  function buildCutArgs(inputPath, keepSegments, outputPath, hasVideo) {
    var filterParts = [];
    var concatInputs = "";
    for (var i = 0; i < keepSegments.length; i++) {
      var seg = keepSegments[i];
      if (hasVideo) {
        filterParts.push("[0:v]trim=start=" + seg.start + ":end=" + seg.end + ",setpts=PTS-STARTPTS[v" + i + "]");
      }
      filterParts.push("[0:a]atrim=start=" + seg.start + ":end=" + seg.end + ",asetpts=PTS-STARTPTS[a" + i + "]");
      concatInputs += hasVideo ? ("[v" + i + "][a" + i + "]") : ("[a" + i + "]");
    }
    var n = keepSegments.length;
    var concatFilter = concatInputs + "concat=n=" + n + ":v=" + (hasVideo ? 1 : 0) + ":a=1" + (hasVideo ? "[outv][outa]" : "[outa]");
    filterParts.push(concatFilter);

    var args = ["-y", "-i", inputPath, "-filter_complex", filterParts.join(";")];
    if (hasVideo) args.push("-map", "[outv]");
    args.push("-map", "[outa]");
    if (hasVideo) args.push("-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p");
    args.push("-c:a", "aac", "-b:a", "192k");
    args.push(outputPath);
    return args;
  }

  function totalDuration(segments) {
    return segments.reduce(function (sum, s) { return sum + (s.end - s.start); }, 0);
  }

  // ---------- execução (Node/ffmpeg) ----------

  function execFile(bin, args, cb) {
    var cp = require("child_process");
    cp.execFile(bin, args, { maxBuffer: 1024 * 1024 * 100 }, cb);
  }

  function tryBinaries(candidates, args, cb) {
    var i = 0;
    function next() {
      if (i >= candidates.length) { cb(new Error("Binário não encontrado (ffmpeg/ffprobe não localizado no sistema).")); return; }
      var bin = candidates[i++];
      execFile(bin, args, function (err, stdout, stderr) {
        if (err && err.code === "ENOENT" && i < candidates.length) { next(); return; }
        cb(err, stdout, stderr);
      });
    }
    next();
  }

  function getDuration(filePath, cb) {
    tryBinaries(
      FFPROBE_CANDIDATES,
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath],
      function (err, stdout) {
        if (err) { cb(err); return; }
        var v = parseFloat(stdout);
        if (isNaN(v)) { cb(new Error("Não consegui ler a duração do arquivo.")); return; }
        cb(null, v);
      }
    );
  }

  function detectSilence(filePath, startSec, durationSec, thresholdDb, minDurSec, cb) {
    var args = ["-ss", String(startSec), "-i", filePath, "-t", String(durationSec),
      "-af", "silencedetect=noise=" + thresholdDb + "dB:d=" + minDurSec, "-f", "null", "-"];
    tryBinaries(FFMPEG_CANDIDATES, args, function (err, stdout, stderr) {
      // silencedetect sempre "falha" com -f null (sem erro real) — stderr é o que importa
      cb(null, stderr || "");
    });
  }

  function runCut(inputPath, keepSegments, outputPath, hasVideo, cb) {
    var args = buildCutArgs(inputPath, keepSegments, outputPath, hasVideo);
    tryBinaries(FFMPEG_CANDIDATES, args, function (err, stdout, stderr) {
      if (err) { cb(new Error("Falha ao renderizar o corte: " + err.message)); return; }
      cb(null, outputPath);
    });
  }

  // opts: {filePath, mediaType ("Video"|"Audio"), sourceIn, sourceOut, thresholdDb, minDurSec, paddingSec, outputPath}
  function process(opts, onProgress, cb) {
    onProgress && onProgress("Lendo informações do arquivo...");

    function withRange(rangeStart, rangeEnd) {
      onProgress && onProgress("Detectando silêncio...");
      detectSilence(opts.filePath, rangeStart, rangeEnd - rangeStart, opts.thresholdDb, opts.minDurSec, function (err, stderrText) {
        if (err) { cb(err); return; }

        var silences = parseSilenceLines(stderrText, rangeStart, rangeEnd);
        var keep = computeKeepSegments(silences, rangeStart, rangeEnd, opts.paddingSec);

        if (keep.length === 0) {
          cb(new Error("O clipe inteiro foi classificado como silêncio — tente um limiar (dB) mais baixo."));
          return;
        }
        if (keep.length === 1 && Math.abs(keep[0].start - rangeStart) < 0.05 && Math.abs(keep[0].end - rangeEnd) < 0.05) {
          cb(null, { skipped: true, keepCount: 1, removedSeconds: 0 });
          return;
        }
        if (keep.length > MAX_SEGMENTS) {
          cb(new Error("Foram encontrados " + keep.length + " trechos de fala — mais do que o suporte atual (" + MAX_SEGMENTS + "). Tente um limiar de silêncio menos sensível."));
          return;
        }

        onProgress && onProgress("Renderizando versão cortada (" + keep.length + " trechos, pode levar um tempo)...");
        var originalDur = rangeEnd - rangeStart;
        var keptDur = totalDuration(keep);

        runCut(opts.filePath, keep, opts.outputPath, opts.mediaType !== "Audio", function (err2, outPath) {
          if (err2) { cb(err2); return; }
          cb(null, {
            skipped: false,
            outputPath: outPath,
            keepCount: keep.length,
            originalSeconds: originalDur,
            keptSeconds: keptDur,
            removedSeconds: originalDur - keptDur
          });
        });
      });
    }

    if (opts.sourceIn !== null && opts.sourceIn !== undefined && opts.sourceOut !== null && opts.sourceOut !== undefined) {
      withRange(opts.sourceIn, opts.sourceOut);
    } else {
      getDuration(opts.filePath, function (err, dur) {
        if (err) { cb(err); return; }
        withRange(0, dur);
      });
    }
  }

  return {
    parseSilenceLines: parseSilenceLines,
    computeKeepSegments: computeKeepSegments,
    buildCutArgs: buildCutArgs,
    totalDuration: totalDuration,
    process: process
  };
});
