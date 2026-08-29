// Script ExtendScript original que aplica os efeitos Zoom, Velocidade e Alinhamento
// nos clipes selecionados da sequência ativa do Premiere Pro.

function _findComponent(trackItem, displayName) {
  for (var i = 0; i < trackItem.components.numItems; i++) {
    var c = trackItem.components[i];
    if (c.displayName === displayName) return c;
  }
  return null;
}

function _findParam(component, displayName) {
  for (var i = 0; i < component.properties.numItems; i++) {
    var p = component.properties[i];
    if (p.displayName === displayName) return p;
  }
  return null;
}

function _timeAt(seconds) {
  var t = new Time();
  t.seconds = seconds;
  return t;
}

// IMPORTANTE — convenção de POSIÇÃO no Premiere:
// O parâmetro "Posição" do componente Movimento NÃO usa pixels: usa coordenadas
// normalizadas em relação ao quadro da sequência, onde [0,0] é o canto superior
// esquerdo, [1,1] é o canto inferior direito e [0.5,0.5] é o centro.
// Passar pixels (ex.: 960) faz o Premiere interpretar como "960x a largura do quadro"
// e o valor estoura no limite interno de 32767px. Toda a matemática de posição
// deste arquivo trabalha em unidades normalizadas.
var _POS_CENTER_X = 0.5;
var _POS_CENTER_Y = 0.5;

// Valores multi-dimensionais (Posição, Ponto de Ancoragem...) chegam como
// arrays vindos do lado nativo do Premiere. `instanceof Array` não é confiável
// para objetos que cruzam essa fronteira, então checamos a forma.
function _isArrayLike(v) {
  return v !== null && typeof v === "object" && typeof v.length === "number";
}

// Curvas de easing (equações clássicas de Robert Penner, domínio público).
// easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "back"
function _ease(easing, t) {
  switch (easing) {
    case "easeIn":
      return t * t;
    case "easeOut":
      return 1 - (1 - t) * (1 - t);
    case "easeInOut":
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case "back": {
      var c1 = 1.70158, c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    default:
      return t;
  }
}

// Curva de Bézier cúbica genérica (P0=0,0 e P3=1,1 fixos, P1/P2 arrastáveis pelo usuário
// no editor visual). Resolve x(t)=alvo por Newton-Raphson, igual navegadores fazem para
// CSS cubic-bezier(), depois lê y(t).
function _bezierAxis(t, p1, p2) {
  var mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

function _bezierAxisDerivative(t, p1, p2) {
  var mt = 1 - t;
  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

function _solveBezierT(x, p1x, p2x) {
  var t = x;
  for (var i = 0; i < 8; i++) {
    var dx = _bezierAxis(t, p1x, p2x) - x;
    var d = _bezierAxisDerivative(t, p1x, p2x);
    if (Math.abs(d) < 1e-6) break;
    t -= dx / d;
    t = Math.max(0, Math.min(1, t));
  }
  return t;
}

function _bezierEase(p1x, p1y, p2x, p2y, x) {
  if (p1x === p1y && p2x === p2y) return x;
  var t = _solveBezierT(x, p1x, p2x);
  return _bezierAxis(t, p1y, p2y);
}

// Igual a _bakeEasedKeyframes, mas com uma curva de Bézier customizada (P1/P2 vindos
// do editor visual) em vez de um preset nomeado.
function _bakeBezierKeyframes(param, startSeconds, durationSeconds, fromValue, toValue, p1x, p1y, p2x, p2y, steps) {
  if (!param.isTimeVarying()) param.setTimeVarying(true);
  steps = steps || 16;
  var isArr = _isArrayLike(fromValue);

  for (var i = 0; i <= steps; i++) {
    var x = i / steps;
    var e = _bezierEase(p1x, p1y, p2x, p2y, x);
    var time = _timeAt(startSeconds + durationSeconds * x);
    var val = isArr
      ? [fromValue[0] + (toValue[0] - fromValue[0]) * e, fromValue[1] + (toValue[1] - fromValue[1]) * e]
      : fromValue + (toValue - fromValue) * e;
    param.addKey(time);
    param.setValueAtKey(time, val, true);
  }
}

// Em vez de depender de uma API incerta de tipo de interpolação do Premiere, "assamos"
// a curva de easing diretamente em várias keyframes intermediárias — funciona com as
// mesmas chamadas (addKey/setValueAtKey) já usadas no resto do script.
function _bakeEasedKeyframes(param, startSeconds, durationSeconds, fromValue, toValue, easing, steps) {
  if (!param.isTimeVarying()) param.setTimeVarying(true);
  steps = steps || 14;
  var isArr = _isArrayLike(fromValue);

  for (var i = 0; i <= steps; i++) {
    var t = i / steps;
    var e = _ease(easing, t);
    var time = _timeAt(startSeconds + durationSeconds * t);
    var val = isArr
      ? [fromValue[0] + (toValue[0] - fromValue[0]) * e, fromValue[1] + (toValue[1] - fromValue[1]) * e]
      : fromValue + (toValue - fromValue) * e;
    param.addKey(time);
    param.setValueAtKey(time, val, true);
  }
}

// Retorna os TrackItems de vídeo selecionados na sequência ativa.
function _getSelectedVideoItems(seq) {
  var items = [];

  if (typeof seq.getSelection === "function") {
    var sel = seq.getSelection();
    for (var i = 0; i < sel.length; i++) {
      if (sel[i].mediaType === "Video") items.push(sel[i]);
    }
    if (items.length > 0) return items;
  }

  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (typeof clip.isSelected === "function" && clip.isSelected()) {
        items.push(clip);
      }
    }
  }
  return items;
}

function _requireSequence() {
  var seq = app.project.activeSequence;
  if (!seq) throw new Error("Nenhuma sequência ativa. Abra uma sequência no Premiere.");
  return seq;
}

function _getSelectedAudioItems(seq) {
  var items = [];

  if (typeof seq.getSelection === "function") {
    var sel = seq.getSelection();
    for (var i = 0; i < sel.length; i++) {
      if (sel[i].mediaType === "Audio") items.push(sel[i]);
    }
    if (items.length > 0) return items;
  }

  for (var t = 0; t < seq.audioTracks.numTracks; t++) {
    var track = seq.audioTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (typeof clip.isSelected === "function" && clip.isSelected()) {
        items.push(clip);
      }
    }
  }
  return items;
}

// ---------- ZOOM ----------
// direction: "in" (cresce ao longo do clipe) ou "out" (diminui)
// amountPercent: quanto somar/subtrair da escala (ex.: 25 = de 100% a 125%)
// easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "back"
function applyZoom(direction, amountPercent, easing) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var amount = parseFloat(amountPercent);
    var applied = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;
      var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
      if (!scale) continue;

      var start = item.start.seconds;
      var end = item.end.seconds;
      var from = direction === "in" ? 100 : (100 + amount);
      var to = direction === "in" ? (100 + amount) : 100;

      _bakeEasedKeyframes(scale, start, end - start, from, to, easing || "linear");
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível localizar o parâmetro Escala nos clipes selecionados.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// A QE DOM (legada/não documentada) expressa tempo em "ticks" (254016000000 por
// segundo). O formato exato de qeItem.start/.inPoint/.outPoint varia entre versões
// do Premiere: às vezes é um número (ou string) cru de ticks, às vezes um objeto
// Time-like com .ticks ou .seconds. Esta função tenta todas as formas conhecidas
// antes de desistir (mesmo espírito de _getParamKeyTimes, para a mesma classe de
// API não documentada).
var _TICKS_PER_SECOND = 254016000000;

function _qeTicksToSeconds(val) {
  if (val === null || typeof val === "undefined") return NaN;

  if (typeof val === "object") {
    if (typeof val.seconds === "number") return val.seconds;
    if (typeof val.ticks !== "undefined") {
      var fromTicks = parseFloat(val.ticks);
      if (!isNaN(fromTicks)) return fromTicks / _TICKS_PER_SECOND;
    }
    var fromString = parseFloat(String(val));
    return isNaN(fromString) ? NaN : fromString / _TICKS_PER_SECOND;
  }

  var n = parseFloat(val);
  return isNaN(n) ? NaN : n / _TICKS_PER_SECOND;
}

// mediaType: "Video" | "Audio"
// Duas estratégias independentes, porque nenhuma sozinha é confiável em toda
// versão do Premiere (API não documentada):
//  1) casar pelo tempo de início convertido de ticks — falha se o formato de
//     qeItem.start não bater com nenhuma das formas tratadas por _qeTicksToSeconds
//  2) casar pela POSIÇÃO do clipe dentro da trilha — a QE DOM lista os itens na
//     mesma ordem da trilha da DOM normal, então o índice do clipe selecionado
//     deve bater com o índice na QE DOM mesmo quando a leitura de tempo falha
function _findQeItemGeneric(seq, trackItem, mediaType) {
  if (typeof qe === "undefined") return null;
  var qeSeq = qe.project.getActiveSequence();
  if (!qeSeq) return null;
  var numTracks = mediaType === "Audio" ? qeSeq.numAudioTracks : qeSeq.numVideoTracks;

  for (var t = 0; t < numTracks; t++) {
    var qeTrack = mediaType === "Audio" ? qeSeq.getAudioTrackAt(t) : qeSeq.getVideoTrackAt(t);
    for (var c = 0; c < qeTrack.numItems; c++) {
      var qeItem = qeTrack.getItemAt(c);
      var qeStartSec = _qeTicksToSeconds(qeItem.start);
      if (!isNaN(qeStartSec) && Math.abs(qeStartSec - trackItem.start.seconds) < 0.05) {
        return qeItem;
      }
    }
  }

  var trackIndex = _findTrackIndexOf(seq, trackItem) - 1;
  if (trackIndex >= 0 && trackIndex < numTracks) {
    var domTracks = mediaType === "Audio" ? seq.audioTracks : seq.videoTracks;
    var domTrack = domTracks[trackIndex];
    var qeTrackFallback = mediaType === "Audio" ? qeSeq.getAudioTrackAt(trackIndex) : qeSeq.getVideoTrackAt(trackIndex);
    for (var ci = 0; ci < domTrack.clips.numItems; ci++) {
      var domClip = domTrack.clips[ci];
      if (domClip === trackItem || Math.abs(domClip.start.seconds - trackItem.start.seconds) < 0.001) {
        return ci < qeTrackFallback.numItems ? qeTrackFallback.getItemAt(ci) : null;
      }
    }
  }

  return null;
}

function _findTrackIndexOf(seq, item) {
  var tracks = item.mediaType === "Audio" ? seq.audioTracks : seq.videoTracks;
  for (var t = 0; t < tracks.numTracks; t++) {
    var track = tracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      if (clip === item || Math.abs(clip.start.seconds - item.start.seconds) < 0.001) {
        return t + 1;
      }
    }
  }
  return 1;
}

// ---------- ALINHAMENTO (grid de âncora 3x3) ----------
// Calcula a meia-largura/meia-altura do clipe em unidades normalizadas, a partir
// da Escala atual (assumindo que o clipe preenche o quadro em Escala 100%). Um
// clipe maior que o quadro não tem "folga" para alinhar: o resultado é limitado
// a 0.5 (fica no centro).
function _halfExtentForMotion(motion, item) {
  var half = 0.5;
  var scaleParam = _findParam(motion, "Scale") || _findParam(motion, "Escala");
  if (scaleParam) {
    var sv = null;
    try {
      sv = (typeof scaleParam.isTimeVarying === "function" && scaleParam.isTimeVarying())
        ? scaleParam.getValueAtTime(_timeAt(item.start.seconds))
        : scaleParam.getValue();
    } catch (e) {
      sv = null;
    }
    var svNum = parseFloat(sv);
    if (!isNaN(svNum) && svNum > 0) half = (svNum / 100) / 2;
  }
  return half > 0.5 ? 0.5 : half;
}

// anchorX: "left" | "center" | "right"   anchorY: "top" | "middle" | "bottom"
// Os 9 pontos clássicos de ancoragem (cantos, bordas, centro) do grid 3x3 do painel.
// Cada clique define os DOIS eixos de uma vez — diferente do antigo esquema de 6
// botões de eixo único.
function applyAnchorAlignment(anchorX, anchorY) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var applied = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;
      var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
      if (!position) continue;

      var half = _halfExtentForMotion(motion, item);
      var x = anchorX === "left" ? half : (anchorX === "right" ? 1 - half : _POS_CENTER_X);
      var y = anchorY === "top" ? half : (anchorY === "bottom" ? 1 - half : _POS_CENTER_Y);

      if (position.isTimeVarying()) position.setTimeVarying(false);
      position.setValue([x, y], true);
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível localizar o parâmetro Posição nos clipes selecionados.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// ---------- UTILIDADES DE MOVIMENTO (copiar / colar / zerar) ----------
function copyMotion() {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione um clipe de vídeo para copiar o movimento.";

    var item = items[0];
    var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
    if (!motion) return "erro:Este clipe não tem o componente Motion.";

    var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
    var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
    var rotation = _findParam(motion, "Rotation") || _findParam(motion, "Rotação");
    var opacity = _findComponent(item, "Opacity") || _findComponent(item, "Opacidade");
    var opParam = opacity ? (_findParam(opacity, "Opacity") || _findParam(opacity, "Opacidade")) : null;

    var data = {
      position: position ? position.getValue() : null,
      scale: scale ? scale.getValue() : null,
      rotation: rotation ? rotation.getValue() : null,
      opacity: opParam ? opParam.getValue() : null
    };

    return "ok:" + JSON.stringify(data);
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// dataJson: string retornada por copyMotion() (o "ok:" já removido pelo painel)
function pasteMotion(dataJson) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var data = JSON.parse(dataJson);
    var applied = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;

      var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
      var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
      var rotation = _findParam(motion, "Rotation") || _findParam(motion, "Rotação");
      var opacity = _findComponent(item, "Opacity") || _findComponent(item, "Opacidade");
      var opParam = opacity ? (_findParam(opacity, "Opacity") || _findParam(opacity, "Opacidade")) : null;

      if (position && data.position) {
        if (position.isTimeVarying()) position.setTimeVarying(false);
        position.setValue(data.position, true);
      }
      if (scale && data.scale !== null && data.scale !== undefined) {
        if (scale.isTimeVarying()) scale.setTimeVarying(false);
        scale.setValue(data.scale, true);
      }
      if (rotation && data.rotation !== null && data.rotation !== undefined) {
        if (rotation.isTimeVarying()) rotation.setTimeVarying(false);
        rotation.setValue(data.rotation, true);
      }
      if (opParam && data.opacity !== null && data.opacity !== undefined) {
        if (opParam.isTimeVarying()) opParam.setTimeVarying(false);
        opParam.setValue(data.opacity, true);
      }
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível colar o movimento.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

function resetMotion() {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var applied = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;

      var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
      var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
      var rotation = _findParam(motion, "Rotation") || _findParam(motion, "Rotação");
      var opacity = _findComponent(item, "Opacity") || _findComponent(item, "Opacidade");
      var opParam = opacity ? (_findParam(opacity, "Opacity") || _findParam(opacity, "Opacidade")) : null;

      if (position) {
        if (position.isTimeVarying()) position.setTimeVarying(false);
        position.setValue([_POS_CENTER_X, _POS_CENTER_Y], true);
      }
      if (scale) {
        if (scale.isTimeVarying()) scale.setTimeVarying(false);
        scale.setValue(100, true);
      }
      if (rotation) {
        if (rotation.isTimeVarying()) rotation.setTimeVarying(false);
        rotation.setValue(0, true);
      }
      if (opParam) {
        if (opParam.isTimeVarying()) opParam.setTimeVarying(false);
        opParam.setValue(100, true);
      }
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível zerar o movimento.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// ---------- RECORTAR (crop-to-fill via zoom + âncora) ----------
// Assume que o clipe já preenche o quadro em Escala 100% (ex.: mídia importada com
// "Ajustar ao Tamanho do Quadro"). O corte é feito ampliando e deslocando a âncora.
// anchorX: "left" | "center" | "right"   anchorY: "top" | "middle" | "bottom"
function applyCrop(amountPercent, anchorX, anchorY) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var amount = parseFloat(amountPercent);
    if (!amount || amount <= 0) return "erro:Intensidade de corte inválida.";

    // Em unidades normalizadas, ampliar para a escala s deixa (s-1) de "sobra" em
    // cada eixo; deslocar meia sobra encosta o lado escolhido na borda do quadro.
    var s = 1 + amount / 100;
    var extra = s - 1;

    var x = _POS_CENTER_X;
    if (anchorX === "left") x = _POS_CENTER_X - extra / 2;
    else if (anchorX === "right") x = _POS_CENTER_X + extra / 2;

    var y = _POS_CENTER_Y;
    if (anchorY === "top") y = _POS_CENTER_Y - extra / 2;
    else if (anchorY === "bottom") y = _POS_CENTER_Y + extra / 2;

    var applied = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;
      var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
      var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
      if (!scale || !position) continue;

      if (scale.isTimeVarying()) scale.setTimeVarying(false);
      scale.setValue(100 * s, true);
      if (position.isTimeVarying()) position.setTimeVarying(false);
      position.setValue([x, y], true);
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível localizar Escala/Posição nos clipes selecionados.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// ---------- TELA DIVIDIDA ----------
// layout: "2h" (lado a lado) | "2v" (empilhado) | "4grid" (2x2)
// Usa os clipes de vídeo selecionados, na ordem das trilhas (V1, V2, V3...).
// Mesma premissa da função applyCrop: clipe preenche o quadro em Escala 100%.
function applySplitScreen(layout) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItemsOrderedByTrack(seq);

    var need = layout === "4grid" ? 4 : 2;
    if (items.length < need) {
      return "erro:Selecione " + need + " clipes de vídeo (em trilhas diferentes) para este layout.";
    }
    items = items.slice(0, need);

    var cells;

    if (layout === "2h") {
      cells = [
        { x: 0.25, y: 0.5 },
        { x: 0.75, y: 0.5 }
      ];
    } else if (layout === "2v") {
      cells = [
        { x: 0.5, y: 0.25 },
        { x: 0.5, y: 0.75 }
      ];
    } else {
      cells = [
        { x: 0.25, y: 0.25 },
        { x: 0.75, y: 0.25 },
        { x: 0.25, y: 0.75 },
        { x: 0.75, y: 0.75 }
      ];
    }

    var applied = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;
      var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
      var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
      if (!scale || !position) continue;

      if (scale.isTimeVarying()) scale.setTimeVarying(false);
      scale.setValue(50, true);
      if (position.isTimeVarying()) position.setTimeVarying(false);
      position.setValue([cells[i].x, cells[i].y], true);
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível montar a tela dividida.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// ---------- DISTRIBUIR ----------
// orientation: "row" (lado a lado, uma linha) | "column" (empilhado, uma coluna)
// Generaliza a Tela Dividida para N clipes numa única fileira (em vez de grade fixa).
function applyDistribute(orientation) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItemsOrderedByTrack(seq);
    if (items.length < 2) return "erro:Selecione 2 ou mais clipes de vídeo (em trilhas diferentes) para distribuir.";

    var n = items.length;
    var scaleValue = 100 / n;
    var applied = 0;

    for (var i = 0; i < n; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;
      var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
      var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
      if (!scale || !position) continue;

      var x, y;
      if (orientation === "column") {
        x = _POS_CENTER_X;
        y = (i + 0.5) / n;
      } else {
        x = (i + 0.5) / n;
        y = _POS_CENTER_Y;
      }

      if (scale.isTimeVarying()) scale.setTimeVarying(false);
      scale.setValue(scaleValue, true);
      if (position.isTimeVarying()) position.setTimeVarying(false);
      position.setValue([x, y], true);
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível distribuir os clipes.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// ---------- CASCATA ----------
// Empilha os clipes selecionados (tipo picture-in-picture em camadas), a partir da
// posição/escala atuais do PRIMEIRO clipe selecionado (na ordem das trilhas).
// corner: de que canto os próximos clipes "nascem" — define o sentido do deslocamento.
function applyCascade(scaleStepPercent, offsetStepPercent, corner) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItemsOrderedByTrack(seq);
    if (items.length < 2) return "erro:Selecione 2 ou mais clipes de vídeo (em trilhas diferentes) para a cascata.";

    var scaleStep = parseFloat(scaleStepPercent);
    // offsetStep já é uma fração do quadro (0..1), que é exatamente a unidade de Posição.
    var offsetStep = parseFloat(offsetStepPercent) / 100;

    var signX = (corner === "top-right" || corner === "bottom-right") ? -1 : 1;
    var signY = (corner === "bottom-left" || corner === "bottom-right") ? -1 : 1;

    var baseItem = items[0];
    var baseMotion = _findComponent(baseItem, "Motion") || _findComponent(baseItem, "Movimento");
    if (!baseMotion) return "erro:O primeiro clipe selecionado não tem o componente Motion.";
    var baseScaleParam = _findParam(baseMotion, "Scale") || _findParam(baseMotion, "Escala");
    var basePositionParam = _findParam(baseMotion, "Position") || _findParam(baseMotion, "Posição");
    if (!baseScaleParam || !basePositionParam) return "erro:Não encontrei Escala/Posição no primeiro clipe.";

    var baseScale = baseScaleParam.isTimeVarying() ? baseScaleParam.getValueAtTime(_timeAt(baseItem.start.seconds)) : baseScaleParam.getValue();
    var basePos = basePositionParam.isTimeVarying() ? basePositionParam.getValueAtTime(_timeAt(baseItem.start.seconds)) : basePositionParam.getValue();

    var applied = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;
      var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
      var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
      if (!scale || !position) continue;

      var newScale = Math.max(15, baseScale - i * scaleStep);
      var dx = i * offsetStep * signX;
      var dy = i * offsetStep * signY;

      if (scale.isTimeVarying()) scale.setTimeVarying(false);
      scale.setValue(newScale, true);
      if (position.isTimeVarying()) position.setTimeVarying(false);
      position.setValue([basePos[0] + dx, basePos[1] + dy], true);
      applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível montar a cascata.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

function _getSelectedVideoItemsOrderedByTrack(seq) {
  var items = [];
  for (var t = 0; t < seq.videoTracks.numTracks; t++) {
    var track = seq.videoTracks[t];
    for (var c = 0; c < track.clips.numItems; c++) {
      var clip = track.clips[c];
      var selected = typeof clip.isSelected === "function" ? clip.isSelected() : false;
      if (selected) items.push(clip);
    }
  }
  if (items.length > 0) return items;
  return _getSelectedVideoItems(seq);
}

// ---------- NIVELAR VOZ ----------
// Retorna os clipes de áudio selecionados com o caminho do arquivo de mídia,
// para que o painel (Node.js) meça o loudness via ffmpeg e devolva o ganho a aplicar.
// Além do caminho de mídia, devolve start/end (segundos ABSOLUTOS na timeline)
// e sourceIn (segundos dentro do ARQUIVO fonte, via QE DOM) de cada clipe —
// necessário pro painel medir volume só no trecho realmente usado do arquivo
// (não o arquivo inteiro) e posicionar as keyframes de nivelamento no lugar
// certo da timeline. sourceIn cai pra 0 quando a QE DOM não está disponível
// nesta versão do Premiere (mesmo padrão de getClipSourceForSilenceCut).
function getSelectedAudioSourcePaths() {
  try {
    var seq = _requireSequence();
    var items = _getSelectedAudioItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de áudio na timeline.";

    var list = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var path = "";
      try {
        path = item.projectItem.getMediaPath();
      } catch (e) {
        path = "";
      }

      var sourceIn = 0;
      try {
        if (typeof app.enableQE === "function") {
          app.enableQE();
          var qeItem = _findQeItemGeneric(seq, item, "Audio");
          if (qeItem) {
            var inSec = _qeTicksToSeconds(qeItem.inPoint);
            if (!isNaN(inSec)) sourceIn = inSec;
          }
        }
      } catch (eQe) {
        sourceIn = 0;
      }

      list.push({
        index: i,
        path: path,
        start: item.start.seconds,
        end: item.end.seconds,
        sourceIn: sourceIn
      });
    }
    return "ok:" + JSON.stringify(list);
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// planJson: JSON de {index, keys: [{t, gainDb}]}[] — index bate com a MESMA
// ORDEM/seleção retornada por getSelectedAudioSourcePaths; t é segundos
// ABSOLUTOS na timeline (o painel já soma o início do clipe). Escreve uma
// keyframe do parâmetro Nível em cada ponto — nivelar de verdade significa
// o ganho variar ao longo do clipe (mais nos trechos baixos, menos/negativo
// nos trechos altos), não um valor único fixo pro clipe inteiro.
function applyLevelKeyframesToSelection(planJson) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedAudioItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de áudio na timeline.";

    var groups = JSON.parse(planJson);
    var applied = 0;
    var totalKeys = 0;

    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      if (!g.keys || g.keys.length === 0) continue;
      var item = items[g.index];
      if (!item) continue;
      var volume = _findComponent(item, "Volume");
      if (!volume) continue;
      var level = _findParam(volume, "Level") || _findParam(volume, "Nível");
      if (!level) continue;

      if (!level.isTimeVarying()) level.setTimeVarying(true);
      // Limpa qualquer keyframe de uma tentativa anterior no intervalo do
      // clipe antes de escrever a curva nova, pra não misturar as duas.
      try { level.removeKeyRange(_timeAt(item.start.seconds), _timeAt(item.end.seconds), true); } catch (eClear) {}

      for (var k = 0; k < g.keys.length; k++) {
        var kf = g.keys[k];
        var t = _timeAt(kf.t);
        level.addKey(t);
        level.setValueAtKey(t, kf.gainDb, true);
        totalKeys++;
      }
      applied++;
    }

    return applied > 0
      ? "ok:" + applied + " clipe(s), " + totalKeys + " keyframe(s)"
      : "erro:Não foi possível criar as keyframes de nivelamento nos clipes selecionados.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// ---------- ANIMAR CLIPE/OBJETO ----------
// preset: "slide-left" | "slide-right" | "slide-top" | "slide-bottom" | "fade-in" | "fade-out" | "pop" | "rotate-in"
// easing: "linear" | "easeIn" | "easeOut" | "easeInOut" | "back"
function applyAnimateClip(preset, durationSeconds, easing) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var applied = 0;
    easing = easing || "easeOut";

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;

      var clipStart = item.start.seconds;
      var clipEnd = item.end.seconds;
      var dur = Math.min(parseFloat(durationSeconds), (clipEnd - clipStart) * 0.9);
      if (dur <= 0) continue;

      var ok = false;

      if (preset === "slide-left" || preset === "slide-right" || preset === "slide-top" || preset === "slide-bottom") {
        var position = _findParam(motion, "Position") || _findParam(motion, "Posição");
        if (position) {
          var finalPos = position.getValue();
          // 1.0 = uma largura/altura inteira do quadro, o suficiente para o clipe
          // começar completamente fora da tela.
          var offX = 0, offY = 0;
          if (preset === "slide-left") offX = -1;
          if (preset === "slide-right") offX = 1;
          if (preset === "slide-top") offY = -1;
          if (preset === "slide-bottom") offY = 1;

          _bakeEasedKeyframes(position, clipStart, dur, [finalPos[0] + offX, finalPos[1] + offY], finalPos, easing);
          ok = true;
        }
      } else if (preset === "pop") {
        var scale = _findParam(motion, "Scale") || _findParam(motion, "Escala");
        if (scale) {
          var finalScale = scale.getValue();
          // "pop" sempre usa uma curva com leve exagero (overshoot), é a identidade do preset
          _bakeEasedKeyframes(scale, clipStart, dur, 0, finalScale, "back");
          ok = true;
        }
      } else if (preset === "rotate-in") {
        var rotation = _findParam(motion, "Rotation") || _findParam(motion, "Rotação");
        if (rotation) {
          var finalRot = rotation.getValue();
          _bakeEasedKeyframes(rotation, clipStart, dur, finalRot - 90, finalRot, easing);
          ok = true;
        }
      }

      if (preset === "fade-in" || preset === "fade-out" || preset === "rotate-in") {
        var opacity = _findComponent(item, "Opacity") || _findComponent(item, "Opacidade");
        if (opacity) {
          var opParam = _findParam(opacity, "Opacity") || _findParam(opacity, "Opacidade");
          if (opParam) {
            if (!opParam.isTimeVarying()) opParam.setTimeVarying(true);
            if (preset === "fade-out") {
              opParam.addKey(_timeAt(clipEnd - dur));
              opParam.setValueAtKey(_timeAt(clipEnd - dur), 100, true);
              opParam.addKey(_timeAt(clipEnd));
              opParam.setValueAtKey(_timeAt(clipEnd), 0, true);
            } else {
              opParam.addKey(_timeAt(clipStart));
              opParam.setValueAtKey(_timeAt(clipStart), 0, true);
              opParam.addKey(_timeAt(clipStart + dur));
              opParam.setValueAtKey(_timeAt(clipStart + dur), 100, true);
            }
            ok = true;
          }
        }
      }

      if (ok) applied++;
    }

    return applied > 0 ? "ok:" + applied + " clipe(s)" : "erro:Não foi possível aplicar a animação (parâmetro não encontrado).";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// Lista os tempos (em SEGUNDOS) das keyframes existentes de um parâmetro.
//
// getKeys() é a API correta e retorna um array de objetos Time — foi essa a
// causa do bug "não encontrei 2+ keyframes" mesmo com elas visíveis no
// Controle de Efeitos: antes tentávamos numKeys/getKeyTime, que não existem.
// As outras formas ficam como rede de segurança para versões antigas.
function _getParamKeyTimes(param) {
  var times = [];
  var i;

  try {
    if (typeof param.getKeys === "function") {
      var keys = param.getKeys();
      if (keys && keys.length > 0) {
        for (i = 0; i < keys.length; i++) {
          var k = keys[i];
          times.push((k && typeof k.seconds === "number") ? k.seconds : Number(k));
        }
        return times;
      }
    }
  } catch (e1) {}

  try {
    if (typeof param.numKeys === "number" && param.numKeys > 0 && typeof param.getKeyTime === "function") {
      for (i = 0; i < param.numKeys; i++) times.push(param.getKeyTime(i).seconds);
      if (times.length > 0) return times;
    }
  } catch (e2) {}

  try {
    if (typeof param.numKeys === "function" && typeof param.getKeyTime === "function") {
      var n = param.numKeys();
      for (i = 0; i < n; i++) times.push(param.getKeyTime(i).seconds);
      if (times.length > 0) return times;
    }
  } catch (e3) {}

  return null;
}

// O Premiere exige um OBJETO Time nos setters de keyframe — passar um Number
// cru vira no-op silencioso. Todo tempo passado a addKey/setValueAtKey/
// removeKeyRange/setInterpolationTypeAtKey/getValueAtKey deve vir daqui.
function _kfSupported(param) {
  try {
    return typeof param.areKeyframesSupported !== "function" || param.areKeyframesSupported();
  } catch (e) {
    return true;
  }
}

// ---------- SUAVIZAR MOVIMENTO ----------
// Suaviza (média móvel) as keyframes já existentes de Posição/Escala/Rotação.
// Não é estabilização de imagem (isso exige o Warp Stabilizer, sem API de script).
function _smoothParamKeyframes(param) {
  if (!param.isTimeVarying || !param.isTimeVarying()) return false;

  var times = _getParamKeyTimes(param);
  if (!times || times.length < 3) return false;
  times.sort(function (a, b) { return a - b; });

  var n = times.length;
  var values = [];
  for (var i = 0; i < n; i++) {
    values.push(param.getValueAtKey(_timeAt(times[i])));
  }

  var isArr = _isArrayLike(values[0]);
  for (var pass = 0; pass < 2; pass++) {
    var next = values.slice();
    for (var j = 1; j < n - 1; j++) {
      if (isArr) {
        next[j] = [
          (values[j - 1][0] + values[j][0] + values[j + 1][0]) / 3,
          (values[j - 1][1] + values[j][1] + values[j + 1][1]) / 3
        ];
      } else {
        next[j] = (values[j - 1] + values[j] + values[j + 1]) / 3;
      }
    }
    values = next;
  }

  for (var k = 1; k < n - 1; k++) {
    param.setValueAtKey(_timeAt(times[k]), values[k], true);
  }
  return true;
}

function applySmoothMotion() {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var smoothedClips = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      if (!motion) continue;

      var any = false;
      var names = ["Position", "Posição", "Scale", "Escala", "Rotation", "Rotação"];
      for (var n = 0; n < names.length; n++) {
        var p = _findParam(motion, names[n]);
        if (p && _smoothParamKeyframes(p)) any = true;
      }
      if (any) smoothedClips++;
    }

    return smoothedClips > 0
      ? "ok:" + smoothedClips + " clipe(s)"
      : "erro:Nenhum clipe selecionado tem keyframes de Posição/Escala/Rotação (com 3+ pontos) para suavizar.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

var _PROP_PT_NAME = {
  Position: "Posição",
  Scale: "Escala",
  Rotation: "Rotação",
  Opacity: "Opacidade"
};

// Escreve uma keyframe com valor, forçando interpolação linear. As amostras já
// descrevem a curva ponto a ponto, então qualquer suavização que o Premiere
// aplicasse por conta própria distorceria o desenho feito no editor.
function _writeBakedKey(param, seconds, value) {
  var t = _timeAt(seconds);
  param.addKey(t);
  param.setValueAtKey(t, value, true);
  try { param.setInterpolationTypeAtKey(t, 0, true); } catch (e) {}
}

// Interpola entre dois valores (número ou array) por um fator de fase 0..1.
function _lerpValue(fromVal, toVal, phase) {
  if (_isArrayLike(fromVal)) {
    var out = [];
    for (var d = 0; d < fromVal.length; d++) {
      var a = Number(fromVal[d]);
      var b = Number(_isArrayLike(toVal) ? toVal[d] : toVal);
      out.push(a + (b - a) * phase);
    }
    return out;
  }
  return Number(fromVal) + (Number(toVal) - Number(fromVal)) * phase;
}

// Reformata a curva ENTRE a primeira e a última keyframe já existentes de cada
// propriedade escolhida.
//
// O PAINEL faz toda a amostragem da curva (que pode ser multi-âncora, com
// overshoot e quiques) e manda pares {t, v} já prontos em espaço normalizado:
// t = fase 0..1 no intervalo entre as duas keyframes extremas, v = fase do
// valor (0 = valor da 1ª keyframe, 1 = valor da última, podendo passar disso).
// Aqui o script só mapeia isso para tempo/valor reais e escreve. Manter o
// ExtendScript "burro" evita reimplementar a matemática de Bézier em ES3.
function applyCurveSamples(propsJson, samplesJson) {
  try {
    var seq = _requireSequence();
    var items = _getSelectedVideoItems(seq);
    if (items.length === 0) return "erro:Selecione ao menos um clipe de vídeo na timeline.";

    var props = JSON.parse(propsJson);
    if (!props || props.length === 0) return "erro:Escolha ao menos uma propriedade.";

    var samples = JSON.parse(samplesJson);
    if (!samples || samples.length === 0) return "erro:Curva sem amostras.";

    var applied = 0;
    var notAnimated = 0;
    var eps = 1 / 240;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var motion = _findComponent(item, "Motion") || _findComponent(item, "Movimento");
      var opacity = _findComponent(item, "Opacity") || _findComponent(item, "Opacidade");
      var any = false;

      for (var p = 0; p < props.length; p++) {
        var propName = props[p];
        var param = null;
        if (propName === "Opacity") {
          param = opacity ? (_findParam(opacity, "Opacity") || _findParam(opacity, "Opacidade")) : null;
        } else if (motion) {
          param = _findParam(motion, propName) || _findParam(motion, _PROP_PT_NAME[propName]);
        }
        if (!param || !_kfSupported(param)) continue;
        if (!param.isTimeVarying || !param.isTimeVarying()) continue;

        var times = _getParamKeyTimes(param);
        if (!times || times.length < 2) continue;
        times.sort(function (a, b) { return a - b; });

        var t0 = times[0];
        var t1 = times[times.length - 1];
        var dur = t1 - t0;
        if (dur <= 0) continue;

        var fromVal = param.getValueAtKey(_timeAt(t0));
        var toVal = param.getValueAtKey(_timeAt(t1));

        // Limpa só o MIOLO do intervalo. As keyframes extremas do usuário
        // sobrevivem — recriá-las com addKey zeraria o valor delas.
        param.removeKeyRange(_timeAt(t0 + eps), _timeAt(t1 - eps), true);

        for (var s = 0; s < samples.length; s++) {
          var sm = samples[s];
          var st = t0 + Number(sm.t) * dur;
          if (st <= t0 + eps || st >= t1 - eps) continue;
          _writeBakedKey(param, st, _lerpValue(fromVal, toVal, Number(sm.v)));
        }

        any = true;
      }

      if (any) applied++;
      else notAnimated++;
    }

    if (applied > 0) return "ok:" + applied + " clipe(s)";
    return "erro:Nenhuma propriedade escolhida tem 2+ keyframes nos clipes selecionados. Ative o cronômetro da propriedade no Controle de Efeitos e crie ao menos 2 keyframes.";
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// ---------- CORTE AUTOMÁTICO DE SILÊNCIO ----------
// A detecção/corte roda no Node.js do painel (ffmpeg); estas funções só entregam
// os dados do clipe selecionado e, depois, importam + posicionam o arquivo já cortado.

function getProjectDirectory() {
  try {
    var path = app.project.path;
    if (!path) return "erro:Salve o projeto do Premiere (Ctrl+S) antes de usar o corte automático de silêncio.";
    var lastSlash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    return "ok:" + path.substring(0, lastSlash);
  } catch (e) {
    return "erro:" + e.toString();
  }
}

// Dados do PRIMEIRO clipe (vídeo ou áudio) selecionado na timeline.
function getClipSourceForSilenceCut() {
  try {
    var seq = _requireSequence();
    var videoItems = _getSelectedVideoItems(seq);
    var audioItems = _getSelectedAudioItems(seq);
    var item = videoItems.length > 0 ? videoItems[0] : audioItems[0];
    if (!item) return "erro:Selecione um clipe de vídeo ou áudio na timeline.";

    var path = "";
    try {
      path = item.projectItem.getMediaPath();
    } catch (ePath) {}
    if (!path) return "erro:Não consegui encontrar o arquivo de mídia deste clipe.";

    var sourceIn = null, sourceOut = null;
    try {
      if (typeof app.enableQE === "function") {
        app.enableQE();
        var qeItem = _findQeItemGeneric(seq, item, item.mediaType);
        if (qeItem) {
          sourceIn = _qeTicksToSeconds(qeItem.inPoint);
          sourceOut = _qeTicksToSeconds(qeItem.outPoint);
        }
      }
    } catch (eQe) {
      sourceIn = null;
      sourceOut = null;
    }

    var data = {
      path: path,
      mediaType: item.mediaType,
      trackIndex: _findTrackIndexOf(seq, item),
      timelineStart: item.start.seconds,
      timelineEnd: item.end.seconds,
      sourceIn: sourceIn,
      sourceOut: sourceOut
    };
    return "ok:" + JSON.stringify(data);
  } catch (e) {
    return "erro:" + e.toString();
  }
}

function _findTrackItemAtStart(track, seconds) {
  for (var c = 0; c < track.clips.numItems; c++) {
    var clip = track.clips[c];
    if (Math.abs(clip.start.seconds - seconds) < 0.05) return clip;
  }
  return null;
}

// Remove um clipe da timeline (lift — não desloca os demais clipes da trilha,
// só libera o espaço). A contagem/ordem de parâmetros de QETrackItem.remove()
// não é documentada e varia entre versões do Premiere (mesma classe de
// problema de outras chamadas via QE DOM neste arquivo) — tenta várias
// assinaturas conhecidas.
function _qeRemoveClip(qeItem) {
  var attempts = [
    function () { qeItem.remove(false, true); },
    function () { qeItem.remove(false, false); },
    function () { qeItem.remove(true, true); },
    function () { qeItem.remove(false); },
    function () { qeItem.remove(); }
  ];
  for (var i = 0; i < attempts.length; i++) {
    try {
      attempts[i]();
      return true;
    } catch (e) {
      // tenta a próxima assinatura
    }
  }
  return false;
}

function _findProjectItemByPath(item, targetPath) {
  for (var i = 0; i < item.children.numItems; i++) {
    var child = item.children[i];
    try {
      if (typeof child.getMediaPath === "function" && child.getMediaPath() === targetPath) return child;
    } catch (eGet) {}
    try {
      if (child.children && child.children.numItems > 0) {
        var nested = _findProjectItemByPath(child, targetPath);
        if (nested) return nested;
      }
    } catch (eChildren) {}
  }
  return null;
}

// Importa o arquivo já cortado (gerado pelo ffmpeg) e SUBSTITUI o clipe original
// pela versão cortada, no mesmo lugar. timelineStartSeconds é o início do clipe
// original (não a "seleção atual" — entre o corte ser calculado e este passo
// rodar, o processamento no ffmpeg leva um tempo e a seleção no Premiere pode
// ter mudado, então localizamos o clipe pela POSIÇÃO conhecida, não por seleção).
//
// Passos: acha o clipe original nessa posição -> remove ele (lift, sem
// deslocar o resto da trilha) -> sobrepõe (overwrite) a versão cortada no
// espaço liberado, começando no mesmo ponto. Como o corte remove trechos de
// silêncio, o resultado é MENOR que o espaço liberado — sobra um vão vazio
// depois dele (não deslocamos os clipes seguintes automaticamente).
function importAndPlaceCutFile(filePath, mediaType, trackIndex, timelineStartSeconds) {
  try {
    var seq = _requireSequence();
    app.project.importFiles([filePath], true, app.project.rootItem, false);

    var imported = _findProjectItemByPath(app.project.rootItem, filePath);
    if (!imported) {
      return "erro:O arquivo cortado foi salvo em " + filePath + " e importado, mas não consegui localizá-lo automaticamente no painel de Projeto para inserir na timeline. Arraste-o manualmente.";
    }

    var tIdx = parseInt(trackIndex, 10) - 1;
    var tracks = mediaType === "Audio" ? seq.audioTracks : seq.videoTracks;
    if (tIdx < 0 || tIdx >= tracks.numTracks) return "erro:Trilha de destino inválida.";
    var track = tracks[tIdx];
    var startSec = parseFloat(timelineStartSeconds);

    var originalItem = _findTrackItemAtStart(track, startSec);
    var removedOriginal = false;
    if (originalItem) {
      try {
        if (typeof app.enableQE === "function") app.enableQE();
        var qeOriginal = _findQeItemGeneric(seq, originalItem, mediaType);
        if (qeOriginal) removedOriginal = _qeRemoveClip(qeOriginal);
      } catch (eRemove) {
        removedOriginal = false;
      }
    }

    var placed = track.overwriteClip(imported, startSec);
    if (!placed) {
      return "erro:O arquivo foi cortado e importado, mas a inserção automática na timeline falhou — arraste-o manualmente do painel de Projeto.";
    }

    return removedOriginal
      ? "ok:substituiu o clipe original na timeline"
      : "ok:inserido na timeline, mas não consegui remover automaticamente o clipe original nesta versão do Premiere — se ficou um clipe extra/duplicado, apague-o manualmente";
  } catch (e) {
    return "erro:" + e.toString();
  }
}
