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

  // Faixa de frequência da voz humana falada. Aplicado só na PASSAGEM DE DETECÇÃO
  // (silencedetect roda com "-f null -", não gera arquivo) — o corte em si
  // (runCut/buildCutArgs) sempre opera no áudio original, sem filtro nenhum.
  // Isso é o que separa "pausa na fala" de "silêncio" genérico: grave de música
  // de fundo e ruído de ventilador/tráfego ficam fora dessa faixa e não competem
  // mais com a detecção de quando a pessoa realmente parou de falar.
  var VOICE_HIGHPASS_HZ = 100;
  var VOICE_LOWPASS_HZ = 6000;

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

  // Limiar (dB) calculado a partir do volume médio do próprio clipe, em vez de um
  // valor absoluto fixo que o usuário tem de adivinhar. meanVolumeDb vem do filtro
  // volumedetect do ffmpeg (média de TODO o trecho, fala+pausas). marginDb é
  // quantos dB abaixo dessa média um trecho precisa cair pra contar como pausa —
  // maior = mais tolerante (só silêncio bem "morto" conta), menor = mais sensível.
  function computeAutoThreshold(meanVolumeDb, marginDb) {
    var t = meanVolumeDb - marginDb;
    if (t > -10) t = -10;
    if (t < -60) t = -60;
    return t;
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
    // poles=2 (~12dB/oitava) em vez do padrão de 1 polo (~6dB/oitava): corte mais
    // íngreme separa melhor "grave de música/zumbido" de "voz" — com 1 polo, ruído
    // grave moderadamente alto ainda vazava o suficiente pra mascarar uma pausa real.
    var af = "highpass=f=" + VOICE_HIGHPASS_HZ + ":poles=2,lowpass=f=" + VOICE_LOWPASS_HZ + ":poles=2" +
      ",silencedetect=noise=" + thresholdDb + "dB:d=" + minDurSec;
    var args = ["-ss", String(startSec), "-i", filePath, "-t", String(durationSec),
      "-af", af, "-f", "null", "-"];
    tryBinaries(FFMPEG_CANDIDATES, args, function (err, stdout, stderr) {
      // silencedetect sempre "falha" com -f null (sem erro real) — stderr é o que importa
      cb(null, stderr || "");
    });
  }

  // Volume médio (dB) do trecho, via o filtro volumedetect do ffmpeg — usado só
  // no modo "Automático" pra calcular o limiar (ver computeAutoThreshold).
  function measureNoiseFloor(filePath, startSec, durationSec, cb) {
    var args = ["-ss", String(startSec), "-i", filePath, "-t", String(durationSec),
      "-af", "volumedetect", "-f", "null", "-"];
    tryBinaries(FFMPEG_CANDIDATES, args, function (err, stdout, stderr) {
      if (err) { cb(err); return; }
      var m = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(stderr || "");
      if (!m) { cb(new Error("Não consegui medir o volume médio do áudio.")); return; }
      cb(null, parseFloat(m[1]));
    });
  }

  function runCut(inputPath, keepSegments, outputPath, hasVideo, cb) {
    var args = buildCutArgs(inputPath, keepSegments, outputPath, hasVideo);
    tryBinaries(FFMPEG_CANDIDATES, args, function (err, stdout, stderr) {
      if (err) { cb(new Error("Falha ao renderizar o corte: " + err.message)); return; }
      cb(null, outputPath);
    });
  }

  // opts: {filePath, mediaType ("Video"|"Audio"), sourceIn, sourceOut, minDurSec, paddingSec, outputPath,
  //        autoThreshold (bool) — se true usa opts.marginDb (calcula o limiar a partir
  //        do volume médio do clipe); se false usa opts.thresholdDb (valor manual, dB absoluto)}
  function process(opts, onProgress, cb) {
    onProgress && onProgress("Lendo informações do arquivo...");

    function withThreshold(rangeStart, rangeEnd, thresholdDb) {
      onProgress && onProgress("Detectando pausas na fala...");
      detectSilence(opts.filePath, rangeStart, rangeEnd - rangeStart, thresholdDb, opts.minDurSec, function (err, stderrText) {
        if (err) { cb(err); return; }

        var silences = parseSilenceLines(stderrText, rangeStart, rangeEnd);
        var keep = computeKeepSegments(silences, rangeStart, rangeEnd, opts.paddingSec);

        if (keep.length === 0) {
          cb(new Error("O clipe inteiro foi classificado como pausa — tente diminuir a sensibilidade (ou, no modo manual, usar um limiar mais baixo)."));
          return;
        }
        if (keep.length === 1 && Math.abs(keep[0].start - rangeStart) < 0.05 && Math.abs(keep[0].end - rangeEnd) < 0.05) {
          cb(null, { skipped: true, keepCount: 1, removedSeconds: 0, usedThresholdDb: thresholdDb });
          return;
        }
        if (keep.length > MAX_SEGMENTS) {
          cb(new Error("Foram encontrados " + keep.length + " trechos de fala — mais do que o suporte atual (" + MAX_SEGMENTS + "). Tente uma sensibilidade menor (ou limiar manual mais alto)."));
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
            removedSeconds: originalDur - keptDur,
            usedThresholdDb: thresholdDb
          });
        });
      });
    }

    function withRange(rangeStart, rangeEnd) {
      if (opts.autoThreshold) {
        onProgress && onProgress("Medindo volume médio do áudio...");
        measureNoiseFloor(opts.filePath, rangeStart, rangeEnd - rangeStart, function (errVol, meanVolumeDb) {
          if (errVol) { cb(errVol); return; }
          withThreshold(rangeStart, rangeEnd, computeAutoThreshold(meanVolumeDb, opts.marginDb));
        });
      } else {
        withThreshold(rangeStart, rangeEnd, opts.thresholdDb);
      }
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
    computeAutoThreshold: computeAutoThreshold,
    buildCutArgs: buildCutArgs,
    totalDuration: totalDuration,
    measureNoiseFloor: measureNoiseFloor,
    process: process
  };
});
