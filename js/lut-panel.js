/* Cola de UI do card "Cor" com a pasta presets/: lista os .cube, desenha uma
 * imagem de referência (cartão de cores sintético — nunca depende de um
 * arquivo de imagem externo) e renderiza uma miniatura por LUT com o efeito
 * já aplicado. Só roda dentro do CEP (precisa de `require` do Node, ligado
 * no manifest via --enable-nodejs); fora daí, LutPanel.listCubeFiles()
 * simplesmente devolve uma lista vazia.
 */
(function () {
  "use strict";

  var hasNode = typeof require === "function";
  var fs = hasNode ? require("fs") : null;
  var path = hasNode ? require("path") : null;

  // Acha a raiz da extensão a partir da própria URL deste <script>, em vez de
  // depender de app.getSystemPath (que exigiria ida e volta ao ExtendScript
  // só pra descobrir um caminho que o browser já resolveu sozinho).
  function extensionRoot() {
    if (!hasNode) return null;
    var scripts = document.getElementsByTagName("script");
    for (var i = 0; i < scripts.length; i++) {
      var src = scripts[i].src || "";
      if (/[\\/]lut-panel\.js(\?.*)?$/.test(src)) {
        var fsPath = LutCube.fileUrlToPath(src);
        if (!fsPath) return null;
        return path.dirname(path.dirname(fsPath)); // .../js/lut-panel.js -> raiz
      }
    }
    return null;
  }

  function presetsDir() {
    var root = extensionRoot();
    return root ? path.join(root, "presets") : null;
  }

  // [{name, path}], ordenado por nome. Pasta ausente ou vazia -> [].
  function listCubeFiles() {
    var dir = presetsDir();
    if (!dir) return [];
    var out = [];
    try {
      var entries = fs.readdirSync(dir);
      for (var i = 0; i < entries.length; i++) {
        if (/\.cube$/i.test(entries[i])) {
          out.push({ name: entries[i].replace(/\.cube$/i, ""), path: path.join(dir, entries[i]) });
        }
      }
    } catch (e) {
      return []; // pasta não existe ainda — sem LUTs pra mostrar, não é erro
    }
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }

  function loadLut(filePath) {
    try {
      var text = fs.readFileSync(filePath, "utf8");
      return LutCube.parseCube(text);
    } catch (e) {
      return null;
    }
  }

  // ---- imagem de referência (cartão de cores sintético) ----------------------
  // Três faixas: barras de matiz saturadas, tons de pele, e uma rampa de
  // cinza — o suficiente pra um LUT mostrar como afeta cor, pele e contraste
  // sem precisar de nenhum arquivo de imagem externo.
  var SKIN_TONES = ["#3a2417", "#5c3a24", "#8a5a3c", "#c68a5e", "#e8c39e", "#f5ddc0"];
  var HUE_BARS = ["#e6194b", "#f58231", "#ffe119", "#3cb44b", "#42d4f4", "#4363d8", "#911eb4", "#f032e6"];

  function drawReferenceCard(ctx, w, h) {
    var hueH = Math.round(h * 0.38);
    var skinH = Math.round(h * 0.32);
    var grayH = h - hueH - skinH;

    var i, bw;
    bw = w / HUE_BARS.length;
    for (i = 0; i < HUE_BARS.length; i++) {
      ctx.fillStyle = HUE_BARS[i];
      ctx.fillRect(Math.round(i * bw), 0, Math.ceil(bw) + 1, hueH);
    }

    bw = w / SKIN_TONES.length;
    for (i = 0; i < SKIN_TONES.length; i++) {
      ctx.fillStyle = SKIN_TONES[i];
      ctx.fillRect(Math.round(i * bw), hueH, Math.ceil(bw) + 1, skinH);
    }

    var grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "#000000");
    grad.addColorStop(1, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, hueH + skinH, w, grayH);
  }

  // Desenha a imagem de referência com a LUT aplicada (ou sem LUT nenhum, se
  // lut === null, pra célula "Original"). w/h em pixels do canvas de destino.
  function renderThumb(canvas, lut) {
    var w = canvas.width, h = canvas.height;
    var ctx = canvas.getContext("2d");
    drawReferenceCard(ctx, w, h);
    if (lut) {
      var imageData = ctx.getImageData(0, 0, w, h);
      LutCube.applyToImageData(lut, imageData);
      ctx.putImageData(imageData, 0, 0);
    }
  }

  // Abre a pasta presets/ no Explorer, criando-a antes se ainda não existir
  // (útil na primeira vez, antes do usuário ter colocado qualquer LUT nela).
  function openPresetsFolder() {
    if (!hasNode) return false;
    var dir = presetsDir();
    if (!dir) return false;
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      require("child_process").execFile("explorer", [dir]);
      return true;
    } catch (e) {
      return false;
    }
  }

  window.LutPanel = {
    extensionRoot: extensionRoot,
    presetsDir: presetsDir,
    listCubeFiles: listCubeFiles,
    loadLut: loadLut,
    renderThumb: renderThumb,
    openPresetsFolder: openPresetsFolder
  };
})();
