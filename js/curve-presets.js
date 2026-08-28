/* Presets de curva do card "Suavizar movimento".
 *
 * Portado do projeto Easify (ease/client/js/presets.js) — só a biblioteca de
 * curvas. A parte de import/export em disco do Easify ficou de fora: aqui os
 * presets do usuário vivem em localStorage, como nos outros cards do painel.
 *
 * Formato: v1 {points: [x1,y1,x2,y2]} (bezier simples, semântica CSS) ou
 * v2 {anchors: [...]} (multi-âncora, necessário para bounce/elastic).
 */
(function (root) {
    "use strict";
    var C = root.EFCurves;
    var STORE_KEY = "ragazzo.curvePresets.v2";

    // Helper de tangente horizontal, para as definições de bounce ficarem legíveis.
    function fl(x, y, inDx, outDx) {
        var a = { x: x, y: y };
        if (inDx !== null) { a.in = { dx: -inDx, dy: 0 }; }
        if (outDx !== null) { a.out = { dx: outDx, dy: 0 }; }
        return a;
    }

    var BUILTINS = [
        { name: "Linear", points: [1 / 3, 1 / 3, 2 / 3, 2 / 3] },
        // ---- sine: a família mais suave ----
        { name: "Suave In", points: [0.12, 0, 0.39, 0] },
        { name: "Suave Out", points: [0.61, 1, 0.88, 1] },
        { name: "Suave In-Out", points: [0.37, 0, 0.63, 1] },
        { name: "Ease In", points: [0.42, 0, 1, 1] },
        { name: "Ease In +", points: [0.7, 0, 1, 1] },
        { name: "Ease Out", points: [0, 0, 0.58, 1] },
        { name: "Ease Out +", points: [0, 0, 0.3, 1] },
        { name: "In-Out Leve", points: [0.35, 0.15, 0.65, 0.85] },
        { name: "In-Out", points: [0.42, 0, 0.58, 1] },
        { name: "In-Out Forte", points: [0.7, 0, 0.3, 1] },
        // ---- expo: a mais acentuada entre as suaves ----
        { name: "Expo In", points: [0.7, 0, 0.84, 0] },
        { name: "Expo Out", points: [0.16, 1, 0.3, 1] },
        { name: "Expo In-Out", points: [0.87, 0, 0.13, 1] },
        { name: "Estalo", points: [0.9, 0, 0.1, 1] },
        // ---- caráter: overshoot, antecipação, chicote ----
        { name: "Overshoot Leve", points: [0.34, 1.56, 0.64, 1] },
        { name: "Overshoot", points: [0.3, 0, 0.3, 1.35] },
        { name: "Antecipar", points: [0.4, -0.3, 0.7, 1] },
        { name: "Antecipar +", points: [0.36, 0, 0.66, -0.56] },
        { name: "Chicote", points: [0.68, -0.6, 0.32, 1.6] },
        // ---- quiques (multi-âncora) ----
        {
            // Aproximação do easeOutBounce de Penner: arcos abaixo da linha,
            // tocando 1 a cada quique.
            name: "Quique Out",
            anchors: [
                { x: 0, y: 0, out: { dx: 0.1212, dy: 0 } },
                { x: 0.3636, y: 1, in: { dx: -0.1212, dy: -0.6667 }, out: { dx: 0.0606, dy: -0.1667 } },
                { x: 0.5455, y: 0.75, in: { dx: -0.0606, dy: 0 }, out: { dx: 0.0606, dy: 0 } },
                { x: 0.7273, y: 1, in: { dx: -0.0606, dy: -0.1667 }, out: { dx: 0.0202, dy: -0.0417 } },
                { x: 0.8636, y: 0.9375, in: { dx: -0.0707, dy: 0 }, out: { dx: 0.0707, dy: 0 } },
                { x: 1, y: 1, in: { dx: -0.0202, dy: -0.0417 } }
            ]
        },
        {
            // Passa de 1 uma vez e assenta — o "soco" clássico de escala.
            name: "Quique Leve",
            anchors: [
                { x: 0, y: 0, out: { dx: 0.12, dy: 0.3 } },
                fl(0.4, 1.12, 0.12, 0.1),
                fl(0.7, 0.96, 0.1, 0.08),
                { x: 1, y: 1, in: { dx: -0.1, dy: 0 } }
            ]
        },
        {
            // Overshoot maior, com oscilação extra antes de assentar.
            name: "Quique Forte",
            anchors: [
                { x: 0, y: 0, out: { dx: 0.08, dy: 0.4 } },
                fl(0.32, 1.28, 0.08, 0.07),
                fl(0.55, 0.85, 0.07, 0.06),
                fl(0.78, 1.08, 0.06, 0.05),
                { x: 1, y: 1, in: { dx: -0.07, dy: 0 } }
            ]
        },
        {
            // Quique Out espelhado: quica no chão primeiro e depois sobe.
            name: "Quique In",
            anchors: [
                { x: 0, y: 0, out: { dx: 0.0202, dy: 0.0417 } },
                { x: 0.1364, y: 0.0625, in: { dx: -0.0707, dy: 0 }, out: { dx: 0.0707, dy: 0 } },
                { x: 0.2727, y: 0, in: { dx: -0.0202, dy: 0.0417 }, out: { dx: 0.0606, dy: 0.1667 } },
                { x: 0.4545, y: 0.25, in: { dx: -0.0606, dy: 0 }, out: { dx: 0.0606, dy: 0 } },
                { x: 0.6364, y: 0, in: { dx: -0.0606, dy: 0.1667 }, out: { dx: 0.1212, dy: 0.6667 } },
                { x: 1, y: 1, in: { dx: -0.1212, dy: 0 } }
            ]
        },
        {
            // Mola que oscila em torno do alvo antes de descansar.
            name: "Elástico",
            anchors: [
                { x: 0, y: 0, out: { dx: 0.05, dy: 0.5 } },
                fl(0.16, 1.32, 0.05, 0.06),
                fl(0.36, 0.78, 0.06, 0.06),
                fl(0.56, 1.12, 0.06, 0.05),
                fl(0.74, 0.95, 0.05, 0.05),
                fl(0.88, 1.02, 0.04, 0.04),
                { x: 1, y: 1, in: { dx: -0.04, dy: 0 } }
            ]
        }
    ];

    function toCurve(p) {
        return p.anchors ? C.norm({ anchors: p.anchors }) : C.fromPoints(p.points);
    }

    // ---- presets do usuário (localStorage) ----------------------------------
    function loadUser() {
        try {
            var raw = localStorage.getItem(STORE_KEY);
            if (!raw) { return []; }
            var arr = JSON.parse(raw);
            return (arr instanceof Array) ? arr : [];
        } catch (e) { return []; }
    }

    function saveUser(list) {
        try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch (e) {}
    }

    function addUser(name, curve) {
        var list = loadUser();
        list.push({ name: name, version: 2, anchors: C.norm(curve).anchors });
        saveUser(list);
        return list;
    }

    function removeUser(index) {
        var list = loadUser();
        if (index >= 0 && index < list.length) { list.splice(index, 1); saveUser(list); }
        return list;
    }

    // ---- miniatura SVG de um preset ----------------------------------------
    // Desenha a curva num viewBox 0..1 com margem para overshoot/antecipação.
    function thumbPath(curve, samples) {
        curve = C.norm(curve);
        var n = samples || 24;
        var lo = 0, hi = 1, i, v;
        for (i = 0; i <= n; i++) {
            v = C.valueAt(curve, i / n);
            if (v < lo) { lo = v; }
            if (v > hi) { hi = v; }
        }
        var pad = 0.12 * (hi - lo);
        lo -= pad; hi += pad;
        var d = "";
        for (i = 0; i <= n; i++) {
            var x = i / n;
            var y = (C.valueAt(curve, x) - lo) / (hi - lo);
            d += (i === 0 ? "M" : "L") + (x * 100).toFixed(2) + "," + ((1 - y) * 100).toFixed(2) + " ";
        }
        return d.replace(/\s+$/, "");
    }

    root.CurvePresets = {
        builtins: BUILTINS,
        toCurve: toCurve,
        loadUser: loadUser,
        addUser: addUser,
        removeUser: removeUser,
        thumbPath: thumbPath
    };
}(typeof self !== "undefined" ? self : this));
