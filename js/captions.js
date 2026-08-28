// Estado e edição das legendas: lista de cues {start, end, text} em segundos,
// import/export .srt, e geração na timeline via hostscript.jsx.

(function (global) {
  var cues = [];
  var listEl;

  function secondsToLabel(sec) {
    sec = Math.max(0, sec || 0);
    var m = Math.floor(sec / 60);
    var s = (sec - m * 60).toFixed(2);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function labelToSeconds(label) {
    label = (label || "").trim();
    if (label.indexOf(":") === -1) return parseFloat(label) || 0;
    var parts = label.split(":");
    var m = parseFloat(parts[0]) || 0;
    var s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }

  function srtTimeToSeconds(t) {
    var m = t.match(/(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!m) return 0;
    return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10) + parseInt(m[4], 10) / 1000;
  }

  function secondsToSrtTime(sec) {
    sec = Math.max(0, sec || 0);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = Math.floor(sec % 60);
    var ms = Math.round((sec - Math.floor(sec)) * 1000);
    function pad(n, len) {
      n = String(n);
      while (n.length < (len || 2)) n = "0" + n;
      return n;
    }
    return pad(h) + ":" + pad(m) + ":" + pad(s) + "," + pad(ms, 3);
  }

  function parseSrt(text) {
    var blocks = text.replace(/\r/g, "").split(/\n\n+/);
    var result = [];
    for (var i = 0; i < blocks.length; i++) {
      var lines = blocks[i].split("\n").filter(function (l) { return l.trim() !== ""; });
      if (lines.length < 2) continue;
      var timeLineIdx = lines[0].indexOf("-->") !== -1 ? 0 : 1;
      var timeLine = lines[timeLineIdx];
      var match = timeLine.match(/(\d+:\d+:\d+[.,]\d+)\s*-->\s*(\d+:\d+:\d+[.,]\d+)/);
      if (!match) continue;
      var textLines = lines.slice(timeLineIdx + 1);
      result.push({
        start: srtTimeToSeconds(match[1]),
        end: srtTimeToSeconds(match[2]),
        text: textLines.join("\n")
      });
    }
    return result;
  }

  function toSrt(cueList) {
    var out = [];
    for (var i = 0; i < cueList.length; i++) {
      out.push(String(i + 1));
      out.push(secondsToSrtTime(cueList[i].start) + " --> " + secondsToSrtTime(cueList[i].end));
      out.push(cueList[i].text || "");
      out.push("");
    }
    return out.join("\n");
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (cues.length === 0) {
      var empty = document.createElement("div");
      empty.className = "caption-empty";
      empty.textContent = "Nenhuma legenda ainda.";
      listEl.appendChild(empty);
      return;
    }

    cues.sort(function (a, b) { return a.start - b.start; });

    cues.forEach(function (cue, idx) {
      var row = document.createElement("div");
      row.className = "caption-row";

      var startInput = document.createElement("input");
      startInput.type = "text";
      startInput.value = secondsToLabel(cue.start);
      startInput.title = "Início (min:seg)";
      startInput.addEventListener("change", function () {
        cue.start = labelToSeconds(startInput.value);
      });

      var endInput = document.createElement("input");
      endInput.type = "text";
      endInput.value = secondsToLabel(cue.end);
      endInput.title = "Fim (min:seg)";
      endInput.addEventListener("change", function () {
        cue.end = labelToSeconds(endInput.value);
      });

      var textInput = document.createElement("input");
      textInput.type = "text";
      textInput.className = "caption-text";
      textInput.value = cue.text;
      textInput.addEventListener("change", function () {
        cue.text = textInput.value;
      });

      var delBtn = document.createElement("button");
      delBtn.className = "caption-del";
      delBtn.textContent = "×";
      delBtn.title = "Remover";
      delBtn.addEventListener("click", function () {
        cues.splice(idx, 1);
        render();
      });

      row.appendChild(startInput);
      row.appendChild(endInput);
      row.appendChild(textInput);
      row.appendChild(delBtn);
      listEl.appendChild(row);
    });
  }

  function addAtSeconds(startSec) {
    var start = startSec || 0;
    cues.push({ start: start, end: start + 2, text: "Nova legenda" });
    render();
  }

  function importSrtText(text) {
    var parsed = parseSrt(text);
    if (parsed.length === 0) return false;
    cues = cues.concat(parsed);
    render();
    return true;
  }

  function exportSrtText() {
    return toSrt(cues);
  }

  function getCues() {
    return cues;
  }

  function init() {
    listEl = document.getElementById("caption-list");
    render();
  }

  global.Captions = {
    init: init,
    render: render,
    addAtSeconds: addAtSeconds,
    importSrtText: importSrtText,
    exportSrtText: exportSrtText,
    getCues: getCues
  };
})(window);
