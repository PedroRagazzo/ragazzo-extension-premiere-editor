(function () {
  var statusEl = document.getElementById("status");
  var statusTextEl = statusEl.querySelector(".status-text");

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

  var anchorButtons = document.querySelectorAll("#anchor-grid .anchor-cell");
  Array.prototype.forEach.call(anchorButtons, function (btn) {
    btn.addEventListener("click", function () {
      Array.prototype.forEach.call(anchorButtons, function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var x = btn.getAttribute("data-x");
      var y = btn.getAttribute("data-y");
      run("applyAnchorAlignment('" + x + "', '" + y + "')");
    });
  });

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

  var animPresetGrid = document.getElementById("anim-preset-grid");
  var animPresetButtons = animPresetGrid.querySelectorAll(".anim-preset-btn");
  Array.prototype.forEach.call(animPresetButtons, function (btn) {
    btn.addEventListener("click", function () {
      Array.prototype.forEach.call(animPresetButtons, function (b) {
        b.classList.remove("selected");
        b.setAttribute("aria-checked", "false");
      });
      btn.classList.add("selected");
      btn.setAttribute("aria-checked", "true");
    });
  });

  document.getElementById("apply-anim").addEventListener("click", function () {
    var selectedBtn = animPresetGrid.querySelector(".anim-preset-btn.selected");
    var preset = selectedBtn ? selectedBtn.getAttribute("data-preset") : "slide-left";
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

  // ---------- Suavizar movimento: editor de curvas ----------
  // Quantas keyframes intermediárias são escritas na timeline. Precisa ser
  // denso o bastante para reproduzir quiques/elástico, sem entupir o Controle
  // de Efeitos: com 28 pontos até o preset "Elástico" (6 oscilações) fica fiel.
  var CURVE_BAKE_SAMPLES = 28;

  var graph = new EZGraph(document.getElementById("curve-canvas"), {});
  graph.setCurve(CurvePresets.toCurve(CurvePresets.builtins[9])); // "In-Out"

  // o canvas lê cores via getComputedStyle (não CSS puro) — precisa ser
  // avisado quando o trocador de tema (js/theme.js) mudar a paleta.
  window.addEventListener("ragazzo-theme-changed", function () { graph.draw(); });

  // O canvas nasce com tamanho zero enquanto o card está fechado; o EZGraph lê
  // getBoundingClientRect() no construtor, então precisa remedir quando o card
  // abre (e quando o painel muda de largura).
  var curveCard = document.getElementById("curve-canvas").closest(".effect-card");
  if (curveCard) {
    var curveHeader = curveCard.querySelector(".effect-header");
    if (curveHeader) {
      curveHeader.addEventListener("click", function () {
        setTimeout(function () { graph.resize(); }, 260); // após a transição do acordeão
      });
    }
  }
  window.addEventListener("resize", function () { graph.resize(); });

  // modo Valor / Velocidade
  var segButtons = document.querySelectorAll(".curve-toolbar .seg-btn");
  Array.prototype.forEach.call(segButtons, function (btn) {
    btn.addEventListener("click", function () {
      Array.prototype.forEach.call(segButtons, function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      graph.setMode(btn.getAttribute("data-mode"));
    });
  });

  // Delete/Backspace remove a âncora selecionada (só quando o canvas tem foco
  // visual, para não sequestrar a tecla enquanto o usuário digita nos campos).
  document.getElementById("curve-canvas").setAttribute("tabindex", "0");
  document.getElementById("curve-canvas").addEventListener("keydown", function (e) {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (graph.deleteActiveAnchor()) e.preventDefault();
    }
  });

  // pré-visualização: roda a fase 0..1 uma vez
  var previewTimer = null;
  document.getElementById("curve-play").addEventListener("click", function () {
    if (previewTimer) { clearInterval(previewTimer); previewTimer = null; }
    var t0 = Date.now();
    var durMs = 1400;
    previewTimer = setInterval(function () {
      var phase = (Date.now() - t0) / durMs;
      if (phase >= 1) {
        graph.setPreviewPhase(1);
        clearInterval(previewTimer);
        previewTimer = null;
        return;
      }
      graph.setPreviewPhase(phase);
    }, 16);
  });

  // ---- grade de presets ----
  var presetGrid = document.getElementById("curve-preset-grid");

  function makePresetCell(preset, onPick, onDelete) {
    var cell = document.createElement("div");
    cell.className = "curve-preset";
    cell.title = preset.name;

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-6 -6 112 112");
    svg.setAttribute("class", "curve-thumb-svg");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", CurvePresets.thumbPath(CurvePresets.toCurve(preset)));
    path.setAttribute("class", "curve-thumb-path");
    svg.appendChild(path);
    cell.appendChild(svg);

    var label = document.createElement("span");
    label.className = "curve-preset-name";
    label.textContent = preset.name;
    cell.appendChild(label);

    cell.addEventListener("click", function () { onPick(preset); });

    if (onDelete) {
      var del = document.createElement("button");
      del.type = "button";
      del.className = "curve-preset-del";
      del.textContent = "×";
      del.title = "Excluir preset";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        onDelete();
      });
      cell.appendChild(del);
    }
    return cell;
  }

  function renderPresets() {
    presetGrid.innerHTML = "";
    CurvePresets.builtins.forEach(function (preset) {
      presetGrid.appendChild(makePresetCell(preset, function (p) {
        graph.setCurve(CurvePresets.toCurve(p));
      }));
    });
    CurvePresets.loadUser().forEach(function (preset, index) {
      presetGrid.appendChild(makePresetCell(preset, function (p) {
        graph.setCurve(CurvePresets.toCurve(p));
      }, function () {
        CurvePresets.removeUser(index);
        renderPresets();
      }));
    });
  }
  renderPresets();

  document.getElementById("curve-save-preset").addEventListener("click", function () {
    var name = window.prompt("Nome do preset:", "Minha curva");
    if (!name) return;
    CurvePresets.addUser(name.trim(), graph.getCurve());
    renderPresets();
    setMessage('Preset "' + name.trim() + '" salvo.', "ok");
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

    // O painel amostra a curva; o ExtendScript só escreve os pares {t, v}.
    var samples = EFCurves.sample(graph.getCurve(), CURVE_BAKE_SAMPLES);
    var payload = samples.map(function (s) {
      return { t: Number(s.time.toFixed(6)), v: Number(s.value.toFixed(6)) };
    });

    run(
      "applyCurveSamples(" +
        JSON.stringify(JSON.stringify(props)) + ", " +
        JSON.stringify(JSON.stringify(payload)) +
        ")"
    );
  });

  var silenceModeToggle = document.getElementById("silence-mode-toggle");
  var silenceModeButtons = silenceModeToggle.querySelectorAll(".seg-btn");
  var silenceAutoRow = document.getElementById("silence-auto-row");
  var silenceAutoHint = document.getElementById("silence-auto-hint");
  var silenceManualRow = document.getElementById("silence-manual-row");

  Array.prototype.forEach.call(silenceModeButtons, function (btn) {
    btn.addEventListener("click", function () {
      Array.prototype.forEach.call(silenceModeButtons, function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      var auto = btn.getAttribute("data-mode") === "auto";
      silenceAutoRow.style.display = auto ? "" : "none";
      silenceAutoHint.style.display = auto ? "" : "none";
      silenceManualRow.style.display = auto ? "none" : "";
    });
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

        var autoMode = silenceModeToggle.querySelector(".seg-btn.active").getAttribute("data-mode") === "auto";
        var marginDb = parseFloat(document.getElementById("silence-margin").value);
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
            autoThreshold: autoMode,
            marginDb: marginDb,
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
            var thresholdTxt = " (limiar usado: " + Math.round(cutResult.usedThresholdDb) + "dB)";
            if (cutResult.skipped) {
              setMessage("Nenhuma pausa significativa encontrada com esses ajustes" + thresholdTxt + " — nada foi cortado.", "ok");
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
                    "Cortado! " + removedTxt + "s de pausa removidos (" + cutResult.keepCount + " trechos de fala)" +
                      thresholdTxt + ". Inserido na timeline.",
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

})();
