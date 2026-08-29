/* Parser de LUT 3D (.cube) + amostragem por interpolação trilinear.
 *
 * Formato .cube: texto simples, padrão da indústria (Adobe, DaVinci Resolve,
 * a maioria dos sites de LUT). Documentação de referência: Adobe "Cube LUT
 * Specification". Suporta só LUT_3D (não LUT_1D).
 *
 * Módulo puro (sem canvas, sem DOM, sem fs) — dual Node/browser, testável
 * isoladamente com `node`, no mesmo espírito de js/curves.js.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) { module.exports = api; }
  if (root) { root.LutCube = api; }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Faz o parse do texto de um arquivo .cube. Retorna
  // { size, domainMin: [r,g,b], domainMax: [r,g,b], data: Array(size^3*3) }
  // com os pontos de grade em ordem r-mais-rápido (padrão do formato — pra
  // cada b, pra cada g, pra cada r, uma linha "R G B"). Retorna null se o
  // texto não for um .cube 3D válido.
  function parseCube(text) {
    if (typeof text !== "string") return null;
    var lines = text.split(/\r\n|\r|\n/);
    var size = null;
    var domainMin = [0, 0, 0];
    var domainMax = [1, 1, 1];
    var values = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line || line.charAt(0) === "#") continue;

      if (/^LUT_3D_SIZE/i.test(line)) {
        var parsedSize = parseInt(line.split(/\s+/)[1], 10);
        if (!isNaN(parsedSize)) size = parsedSize;
        continue;
      }
      if (/^LUT_1D_SIZE/i.test(line)) {
        return null; // LUT 1D não suportado
      }
      if (/^DOMAIN_MIN/i.test(line)) {
        var pMin = line.split(/\s+/).slice(1).map(Number);
        if (pMin.length === 3 && pMin.every(isFinite)) domainMin = pMin;
        continue;
      }
      if (/^DOMAIN_MAX/i.test(line)) {
        var pMax = line.split(/\s+/).slice(1).map(Number);
        if (pMax.length === 3 && pMax.every(isFinite)) domainMax = pMax;
        continue;
      }
      // outra palavra-chave textual (TITLE "...", etc.) — ignora a linha
      if (/^[A-Za-z]/.test(line)) continue;

      var parts = line.split(/\s+/).map(Number);
      if (parts.length === 3 && parts.every(function (n) { return isFinite(n); })) {
        values.push(parts[0], parts[1], parts[2]);
      }
    }

    if (!size || size < 2) return null;
    var expected = size * size * size * 3;
    if (values.length !== expected) return null;

    return { size: size, domainMin: domainMin, domainMax: domainMax, data: values };
  }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  // Valor de saída [r,g,b] no ponto de grade exato (ir,ig,ib) — inteiros 0..size-1.
  function _at(lut, ir, ig, ib) {
    var n = lut.size;
    var idx = (ib * n * n + ig * n + ir) * 3;
    var d = lut.data;
    return [d[idx], d[idx + 1], d[idx + 2]];
  }

  // Mapeia uma cor de entrada (r,g,b em 0..1) pela LUT via interpolação
  // trilinear entre os 8 pontos de grade ao redor. Retorna [r,g,b] (podendo
  // passar de 0..1 se o LUT tiver contraste/saturação exagerados — quem
  // desenha no canvas deve clampar antes de escrever no pixel).
  function sample(lut, r, g, b) {
    var n = lut.size;
    var dr = (lut.domainMax[0] - lut.domainMin[0]) || 1;
    var dg = (lut.domainMax[1] - lut.domainMin[1]) || 1;
    var db = (lut.domainMax[2] - lut.domainMin[2]) || 1;

    var fr = clamp01((r - lut.domainMin[0]) / dr) * (n - 1);
    var fg = clamp01((g - lut.domainMin[1]) / dg) * (n - 1);
    var fb = clamp01((b - lut.domainMin[2]) / db) * (n - 1);

    var r0 = Math.floor(fr), g0 = Math.floor(fg), b0 = Math.floor(fb);
    var r1 = Math.min(r0 + 1, n - 1), g1 = Math.min(g0 + 1, n - 1), b1 = Math.min(b0 + 1, n - 1);
    var tr = fr - r0, tg = fg - g0, tb = fb - b0;

    var c000 = _at(lut, r0, g0, b0), c100 = _at(lut, r1, g0, b0);
    var c010 = _at(lut, r0, g1, b0), c110 = _at(lut, r1, g1, b0);
    var c001 = _at(lut, r0, g0, b1), c101 = _at(lut, r1, g0, b1);
    var c011 = _at(lut, r0, g1, b1), c111 = _at(lut, r1, g1, b1);

    var out = [0, 0, 0];
    for (var k = 0; k < 3; k++) {
      var c00 = c000[k] * (1 - tr) + c100[k] * tr;
      var c10 = c010[k] * (1 - tr) + c110[k] * tr;
      var c01 = c001[k] * (1 - tr) + c101[k] * tr;
      var c11 = c011[k] * (1 - tr) + c111[k] * tr;
      var c0 = c00 * (1 - tg) + c10 * tg;
      var c1 = c01 * (1 - tg) + c11 * tg;
      out[k] = c0 * (1 - tb) + c1 * tb;
    }
    return out;
  }

  // Aplica a LUT num ImageData de canvas (RGBA Uint8ClampedArray), in-place.
  function applyToImageData(lut, imageData) {
    var d = imageData.data;
    for (var i = 0; i < d.length; i += 4) {
      var out = sample(lut, d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      d[i] = clamp01(out[0]) * 255;
      d[i + 1] = clamp01(out[1]) * 255;
      d[i + 2] = clamp01(out[2]) * 255;
      // d[i+3] (alpha) fica como está
    }
  }

  // Converte uma URL file:// (a que o browser resolve pra <script src="...">
  // ou <img src="...">) num caminho de sistema de arquivos usável pelo Node
  // fs/path. Ambíguo entre Windows e Unix: em "file:///C:/..." a barra antes
  // da letra da unidade é só sintaxe da URL (precisa cair fora); em
  // "file:///home/..." a barra INICIAL é o próprio caminho raiz (tem que
  // ficar). Por isso remove só o separador "file://" fixo, e só some com a
  // barra seguinte quando reconhece o padrão de letra-de-unidade do Windows.
  function fileUrlToPath(url) {
    if (typeof url !== "string") return null;
    var stripped = url.replace(/^file:\/\//, "").replace(/^\/([A-Za-z]:)/, "$1");
    try {
      return decodeURIComponent(stripped);
    } catch (e) {
      return stripped;
    }
  }

  return {
    parseCube: parseCube,
    sample: sample,
    applyToImageData: applyToImageData,
    fileUrlToPath: fileUrlToPath
  };
}));
