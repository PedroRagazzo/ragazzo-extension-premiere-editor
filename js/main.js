(function () {
  var statusEl = document.getElementById("status");
  var statusTextEl = statusEl.querySelector(".status-text");
  Captions.init();

  function setMessage(text, cls) {
    statusTextEl.textContent = text;
    statusEl.className = cls || "";
  }

  function setLoading(text) {
    setMessage(text, "loading");
  }

  function setStatus(result) {
    if (typeof result !== "string") {
      setMessage("Erro inesperado.", "err");
      return;
    }
    if (result.indexOf("ok:") === 0) {
      setMessage("Aplicado a " + result.slice(3) + ".", "ok");
    } else if (result.indexOf("erro:") === 0) {
      setMessage(result.slice(5), "err");
    } else {
      setMessage(result, "");
    }
  }

  function run(script) {
    setLoading("Aplicando...");
    CepBridge.evalScript(script, setStatus);
  }

  function runZoom(direction) {
    var amount = document.getElementById("zoom-amount").value;
    var easing = document.getElementById("zoom-easing").value;
    run("applyZoom('" + direction + "', " + JSON.stringify(amount) + ", '" + easing + "')");
  }

  document.getElementById("zoom-in").addEventListener("click", function () { runZoom("in"); });
  document.getElementById("zoom-out").addEventListener("click", function () { runZoom("out"); });

  var ZOOM_PRESETS_KEY = "ragazzoEditor.zoomPresets";

  function loadZoomPresets() {
    try {
      return JSON.parse(localStorage.getItem(ZOOM_PRESETS_KEY) || "[]");
    } catch (e) {
      return [];
    }
  }

  function saveZoomPresets(list) {
    try {
      localStorage.setItem(ZOOM_PRESETS_KEY, JSON.stringify(list));
    } catch (e) {
      // localStorage indisponível (ex.: modo privado) — presets não persistem, sem quebrar a UI
    }
  }

  function renderZoomPresets() {
    var list = loadZoomPresets();
    var container = document.getElementById("zoom-preset-list");
    container.innerHTML = "";
    list.forEach(function (preset, idx) {
      var chip = document.createElement("span");
      chip.className = "preset-chip";

      var label = document.createElement("span");
      label.textContent = preset.name;
      label.addEventListener("click", function () {
        document.getElementById("zoom-amount").value = preset.amount;
        document.getElementById("zoom-amount-range").value = preset.amount;
        document.getElementById("zoom-easing").value = preset.easing;
      });

      var del = document.createElement("button");
      del.className = "preset-del";
      del.textContent = "×";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        list.splice(idx, 1);
        saveZoomPresets(list);
        renderZoomPresets();
      });

      chip.appendChild(label);
      chip.appendChild(del);
      container.appendChild(chip);
    });
  }

  var zoomPresetNewRow = document.getElementById("zoom-preset-new-row");
  var zoomPresetNameInput = document.getElementById("zoom-preset-name");

  document.getElementById("zoom-preset-save").addEventListener("click", function () {
    zoomPresetNewRow.style.display = "flex";
    zoomPresetNameInput.value = "";
    zoomPresetNameInput.focus();
  });

  document.getElementById("zoom-preset-confirm").addEventListener("click", function () {
    var name = zoomPresetNameInput.value.trim();
    if (!name) return;
    var list = loadZoomPresets();
    list.push({
      name: name,
      amount: document.getElementById("zoom-amount").value,
      easing: document.getElementById("zoom-easing").value
    });
    saveZoomPresets(list);
    renderZoomPresets();
    zoomPresetNewRow.style.display = "none";
  });

  zoomPresetNameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") document.getElementById("zoom-preset-confirm").click();
  });

  renderZoomPresets();

  document.getElementById("apply-speed").addEventListener("click", function () {
    var speed = document.getElementById("speed-value").value;
    run("applySpeed(" + JSON.stringify(speed) + ")");
  });

  var alignButtons = document.querySelectorAll("[data-align]");
  for (var i = 0; i < alignButtons.length; i++) {
    alignButtons[i].addEventListener("click", function (e) {
      var align = e.currentTarget.getAttribute("data-align");
      run("applyAlignment('" + align + "')");
    });
  }

  var clipboardMotion = null;

  document.getElementById("motion-copy").addEventListener("click", function () {
    setLoading("Copiando...");
    CepBridge.evalScript("copyMotion()", function (result) {
      if (typeof result === "string" && result.indexOf("ok:") === 0) {
        clipboardMotion = result.slice(3);
        setMessage("Movimento copiado.", "ok");
      } else {
        setStatus(result);
      }
    });
  });

  document.getElementById("motion-paste").addEventListener("click", function () {
    if (!clipboardMotion) {
      setMessage("Copie o movimento de um clipe primeiro.", "err");
      return;
    }
    run("pasteMotion(" + JSON.stringify(clipboardMotion) + ")");
  });

  document.getElementById("motion-reset").addEventListener("click", function () {
    run("resetMotion()");
  });

  document.getElementById("apply-crop").addEventListener("click", function () {
    var amount = document.getElementById("crop-amount").value;
    var ax = document.getElementById("crop-anchor-x").value;
    var ay = document.getElementById("crop-anchor-y").value;
    run("applyCrop(" + JSON.stringify(amount) + ", '" + ax + "', '" + ay + "')");
  });

  var splitButtons = document.querySelectorAll("[data-split]");
  for (var s = 0; s < splitButtons.length; s++) {
    splitButtons[s].addEventListener("click", function (e) {
      var layout = e.currentTarget.getAttribute("data-split");
      run("applySplitScreen('" + layout + "')");
    });
  }

  var distributeButtons = document.querySelectorAll("[data-distribute]");
  for (var d = 0; d < distributeButtons.length; d++) {
    distributeButtons[d].addEventListener("click", function (e) {
      var orientation = e.currentTarget.getAttribute("data-distribute");
      run("applyDistribute('" + orientation + "')");
    });
  }

  document.getElementById("apply-cascade").addEventListener("click", function () {
    var scaleStep = document.getElementById("cascade-scale-step").value;
    var offsetStep = document.getElementById("cascade-offset-step").value;
    var corner = document.getElementById("cascade-corner").value;
    run(
      "applyCascade(" +
        JSON.stringify(scaleStep) + ", " +
        JSON.stringify(offsetStep) + ", '" + corner + "'" +
        ")"
    );
  });

  document.getElementById("apply-level").addEventListener("click", function () {
    var target = parseFloat(document.getElementById("target-lufs").value);
    setLoading("Lendo seleção...");

    CepBridge.evalScript("getSelectedAudioSourcePaths()", function (result) {
      if (typeof result !== "string" || result.indexOf("ok:") !== 0) {
        setStatus(result);
        return;
      }
      var items;
      try {
        items = JSON.parse(result.slice(3));
      } catch (e) {
        setStatus("erro:Resposta inválida do Premiere.");
        return;
      }

      Loudness.measureAndComputeGains(
        items,
        target,
        function (done, total) {
          setLoading("Medindo loudness (" + done + "/" + total + ")...");
        },
        function (gains) {
          setLoading("Aplicando ganho...");
          CepBridge.evalScript("applyGainsToSelection(" + JSON.stringify(JSON.stringify(gains)) + ")", setStatus);
        }
      );
    });
  });

  document.getElementById("apply-duck").addEventListener("click", function () {
    var voiceTrack = document.getElementById("duck-voice-track").value;
    var musicTrack = document.getElementById("duck-music-track").value;
    var amount = document.getElementById("duck-amount").value;
    var fade = document.getElementById("duck-fade").value;
    run(
      "applyDucking(" +
        JSON.stringify(voiceTrack) + ", " +
        JSON.stringify(musicTrack) + ", " +
        JSON.stringify(amount) + ", " +
        JSON.stringify(fade) +
        ")"
    );
  });

  document.getElementById("apply-anim").addEventListener("click", function () {
    var preset = document.getElementById("anim-preset").value;
    var duration = document.getElementById("anim-duration").value;
    var easing = document.getElementById("anim-easing").value;
    run("applyAnimateClip('" + preset + "', " + JSON.stringify(duration) + ", '" + easing + "')");
  });

  document.getElementById("apply-color").addEventListener("click", function () {
    var preset = document.getElementById("color-preset").value;
    var amount = document.getElementById("color-amount").value;
    run("applyColorPreset('" + preset + "', " + JSON.stringify(amount) + ")");
  });

  document.getElementById("apply-smooth").addEventListener("click", function () {
    run("applySmoothMotion()");
  });

  var CURVE_PRESETS = [
    { name: "Linear", points: [0, 0, 1, 1] },
    { name: "Suave", points: [0.25, 0.1, 0.25, 1] },
    { name: "Acelera", points: [0.42, 0, 1, 1] },
    { name: "Desacelera", points: [0, 0, 0.58, 1] },
    { name: "Nas pontas", points: [0.42, 0, 0.58, 1] },
    { name: "Com exagero", points: [0.34, 1.3, 0.64, 1] }
  ];

  var smoothCurve = CurveEditor.create(document.getElementById("smooth-curve-editor"), {
    points: CURVE_PRESETS[1].points
  });

  var curvePresetContainer = document.getElementById("smooth-curve-presets");
  CURVE_PRESETS.forEach(function (preset) {
    var btn = document.createElement("div");
    btn.className = "curve-preset";
    btn.title = preset.name;
    btn.appendChild(CurveEditor.makeThumb(preset.points));
    btn.addEventListener("click", function () {
      smoothCurve.setPoints(preset.points);
    });
    curvePresetContainer.appendChild(btn);
  });

  document.getElementById("apply-curve").addEventListener("click", function () {
    var props = [];
    if (document.getElementById("curve-prop-position").checked) props.push("Position");
    if (document.getElementById("curve-prop-scale").checked) props.push("Scale");
    if (document.getElementById("curve-prop-rotation").checked) props.push("Rotation");
    if (document.getElementById("curve-prop-opacity").checked) props.push("Opacity");

    if (props.length === 0) {
      setMessage("Escolha ao menos uma propriedade.", "err");
      return;
    }

    var pts = smoothCurve.getPoints();
    run(
      "applyCurveToKeyframes(" +
        JSON.stringify(JSON.stringify(props)) + ", " +
        pts[0] + ", " + pts[1] + ", " + pts[2] + ", " + pts[3] +
        ")"
    );
  });

  document.getElementById("apply-broll").addEventListener("click", function () {
    var bin = document.getElementById("broll-bin").value;
    var track = document.getElementById("broll-track").value;
    run("applyBatchBRoll(" + JSON.stringify(bin) + ", " + JSON.stringify(track) + ")");
  });

  document.getElementById("apply-silence-cut").addEventListener("click", function () {
    setLoading("Lendo o clipe selecionado...");

    CepBridge.evalScript("getClipSourceForSilenceCut()", function (result) {
      if (typeof result !== "string" || result.indexOf("ok:") !== 0) { setStatus(result); return; }
      var clip;
      try {
        clip = JSON.parse(result.slice(3));
      } catch (e) {
        setMessage("Resposta inválida do Premiere ao ler o clipe.", "err");
        return;
      }

      CepBridge.evalScript("getProjectDirectory()", function (dirResult) {
        if (typeof dirResult !== "string" || dirResult.indexOf("ok:") !== 0) { setStatus(dirResult); return; }
        var dir = dirResult.slice(3);

        var thresholdDb = parseFloat(document.getElementById("silence-threshold").value);
        var minDur = parseFloat(document.getElementById("silence-min-duration").value);
        var paddingMs = parseFloat(document.getElementById("silence-padding").value);
        var trackField = document.getElementById("silence-track").value;
        var insertTrack = trackField ? parseInt(trackField, 10) : clip.trackIndex + 1;

        var baseName = clip.path.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "");
        var ext = clip.mediaType === "Audio" ? ".wav" : ".mp4";
        var outputPath = dir + "\\AutoCut_" + baseName + "_" + Date.now() + ext;

        SilenceCut.process(
          {
            filePath: clip.path,
            mediaType: clip.mediaType,
            sourceIn: clip.sourceIn,
            sourceOut: clip.sourceOut,
            thresholdDb: thresholdDb,
            minDurSec: minDur,
            paddingSec: paddingMs / 1000,
            outputPath: outputPath
          },
          function (stage) { setLoading(stage); },
          function (err, cutResult) {
            if (err) {
              setMessage(err.message, "err");
              return;
            }
            if (cutResult.skipped) {
              setMessage("Nenhuma pausa significativa encontrada com esses ajustes — nada foi cortado.", "ok");
              return;
            }

            setLoading("Importando e inserindo na timeline...");
            CepBridge.evalScript(
              "importAndPlaceCutFile(" +
                JSON.stringify(cutResult.outputPath) + ", '" + clip.mediaType + "', " +
                JSON.stringify(insertTrack) + ", " + clip.timelineStart +
                ")",
              function (finalResult) {
                if (typeof finalResult === "string" && finalResult.indexOf("ok:") === 0) {
                  var removedTxt = cutResult.removedSeconds.toFixed(1);
                  setMessage(
                    "Cortado! " + removedTxt + "s de silêncio removidos (" + cutResult.keepCount + " trechos de fala). Inserido na timeline.",
                    "ok"
                  );
                } else {
                  setStatus(finalResult);
                }
              }
            );
          }
        );
      });
    });
  });

  document.getElementById("caption-add").addEventListener("click", function () {
    CepBridge.evalScript("getPlayheadSeconds()", function (result) {
      var start = 0;
      if (typeof result === "string" && result.indexOf("ok:") === 0) {
        start = parseFloat(result.slice(3)) || 0;
      }
      Captions.addAtSeconds(start);
    });
  });

  var fileInput = document.getElementById("caption-file-input");
  document.getElementById("caption-import").addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", function () {
    var file = fileInput.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var ok = Captions.importSrtText(String(reader.result));
      setMessage(ok ? "Legendas importadas." : "Não foi possível ler esse arquivo .srt.", ok ? "ok" : "err");
    };
    reader.readAsText(file);
    fileInput.value = "";
  });

  document.getElementById("caption-export").addEventListener("click", function () {
    var srt = Captions.exportSrtText();
    var blob = new Blob([srt], { type: "text/plain" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "legendas.srt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  });

  document.getElementById("caption-generate").addEventListener("click", function () {
    var cues = Captions.getCues();
    if (cues.length === 0) {
      setMessage("Adicione ao menos uma legenda antes de gerar.", "err");
      return;
    }
    var template = document.getElementById("caption-template").value;
    var track = document.getElementById("caption-track").value;
    run(
      "generateCaptionsOnTimeline(" +
        JSON.stringify(JSON.stringify(cues)) + ", " +
        JSON.stringify(template) + ", " +
        JSON.stringify(track) +
        ")"
    );
  });
})();
