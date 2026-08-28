/* Motion Ease presets — starter set + user library.
 *
 * Preset schema v2 (single preset, also the .easify file format):
 *   { name, version: 2, curveType: "bezier",
 *     anchors: [ {x,y,out:{dx,dy}}, {x,y,in:{..},out:{..}}, ..., {x,y,in:{..}} ],
 *     createdAt }
 * v1 files ({ version: 1, points: [x1,y1,x2,y2] }) still import/load and are
 * migrated to v2 on the next write.
 * Library bundle export:
 *   { app: "easify", version: 2, exportedAt, presets: [preset, ...] }
 *
 * User library lives as individual JSON files in
 *   <CEP userData>/Motion Ease/presets/<slug>.json  (migrated from the
 *   pre-rename ".../Easify/presets" on first run)
 * so presets survive panel/Premiere restarts and are human-copyable.
 */
(function (root) {
    "use strict";
    var C = root.EFCurves;
    var cs = new CSInterface();

    var fs = null;
    try {
        fs = window.cep_node ? window.cep_node.require("fs") : require("fs");
    } catch (e) {}

    var USER_DATA = cs.getSystemPath(SystemPath.USER_DATA);
    var LIB_DIR = USER_DATA + "/Motion Ease/presets";
    var LEGACY_DIR = USER_DATA + "/Easify/presets"; // pre-rename location

    // flat-tangent helper for readable bounce definitions
    function fl(x, y, inDx, outDx) {
        var a = { x: x, y: y };
        if (inDx !== null) { a.in = { dx: -inDx, dy: 0 }; }
        if (outDx !== null) { a.out = { dx: outDx, dy: 0 }; }
        return a;
    }

    var BUILTINS = [
        { name: "Linear", points: [1 / 3, 1 / 3, 2 / 3, 2 / 3] },
        // ---- sine: the softest family ----
        { name: "Sine In", points: [0.12, 0, 0.39, 0] },
        { name: "Sine Out", points: [0.61, 1, 0.88, 1] },
        { name: "Sine In-Out", points: [0.37, 0, 0.63, 1] },
        { name: "Ease In", points: [0.42, 0, 1, 1] },
        { name: "Ease In +", points: [0.7, 0, 1, 1] },
        { name: "Ease Out", points: [0, 0, 0.58, 1] },
        { name: "Ease Out +", points: [0, 0, 0.3, 1] },
        { name: "In-Out Gentle", points: [0.35, 0.15, 0.65, 0.85] },
        { name: "In-Out", points: [0.42, 0, 0.58, 1] },
        { name: "In-Out Strong", points: [0.7, 0, 0.3, 1] },
        // ---- expo: the sharpest smooth family ----
        { name: "Expo In", points: [0.7, 0, 0.84, 0] },
        { name: "Expo Out", points: [0.16, 1, 0.3, 1] },
        { name: "Expo In-Out", points: [0.87, 0, 0.13, 1] },
        { name: "In-Out Snap", points: [0.9, 0, 0.1, 1] },
        // ---- character: overshoots, anticipation, whip ----
        { name: "Overshoot Soft", points: [0.34, 1.56, 0.64, 1] },
        { name: "Overshoot", points: [0.3, 0, 0.3, 1.35] },
        { name: "Anticipate", points: [0.4, -0.3, 0.7, 1] },
        { name: "Anticipate +", points: [0.36, 0, 0.66, -0.56] },
        { name: "Whip", points: [0.68, -0.6, 0.32, 1.6] },
        // ---- bounces (multi-anchor) ----
        {
            // Penner easeOutBounce approximation: arcs below the line,
            // touching 1 at each bounce (handles derived from the parabola
            // tangents — see tests/curves.test.js BOUNCE_OUT fixture)
            name: "Bounce Out",
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
            // overshoot once past 1, settle — the classic scale "punch"
            name: "Bounce Soft",
            anchors: [
                { x: 0, y: 0, out: { dx: 0.12, dy: 0.3 } },
                fl(0.4, 1.12, 0.12, 0.1),
                fl(0.7, 0.96, 0.1, 0.08),
                { x: 1, y: 1, in: { dx: -0.1, dy: 0 } }
            ]
        },
        {
            // bigger overshoot, extra oscillation before settling
            name: "Bounce Hard",
            anchors: [
                { x: 0, y: 0, out: { dx: 0.08, dy: 0.4 } },
                fl(0.32, 1.28, 0.08, 0.07),
                fl(0.55, 0.85, 0.07, 0.06),
                fl(0.78, 1.08, 0.06, 0.05),
                { x: 1, y: 1, in: { dx: -0.07, dy: 0 } }
            ]
        },
        {
            // Bounce Out mirrored through the curve's midpoint: bounces along
            // the floor first, then rises — for entrances that "wind up"
            name: "Bounce In",
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
            // springy settle that oscillates across the target before resting
            name: "Elastic Out",
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

    var userPresets = [];   // loaded from disk
    var gridEl;

    // preset (v1 or v2 shape) -> canonical curve
    function toCurve(p) {
        return p.anchors ? C.norm({ anchors: p.anchors }) : C.fromPoints(p.points);
    }

    // ---------- disk ----------
    function ensureDir() {
        if (!fs) { return false; }
        try { fs.mkdirSync(LIB_DIR, { recursive: true }); migrateLegacy(); return true; }
        catch (e) { return fs.existsSync(LIB_DIR); }
    }

    // One-time carry-over of presets saved under the pre-rename "Easify"
    // folder. Copies (never deletes) any .json the new dir doesn't already
    // have, so the rename never loses a user's library.
    function migrateLegacy() {
        if (!fs || LEGACY_DIR === LIB_DIR) { return; }
        var legacy;
        try { legacy = fs.readdirSync(LEGACY_DIR); } catch (e) { return; }
        legacy.forEach(function (f) {
            if (!/\.json$/i.test(f)) { return; }
            var dest = LIB_DIR + "/" + f;
            try {
                if (!fs.existsSync(dest)) {
                    fs.writeFileSync(dest, fs.readFileSync(LEGACY_DIR + "/" + f));
                }
            } catch (e) {}
        });
    }

    function slug(name) {
        return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "preset";
    }

    function uniqueName(base) {
        var names = allNames();
        if (names.indexOf(base) === -1) { return base; }
        var i = 2;
        while (names.indexOf(base + " " + i) !== -1) { i++; }
        return base + " " + i;
    }

    function allNames() {
        return BUILTINS.map(function (p) { return p.name; })
            .concat(userPresets.map(function (p) { return p.name; }));
    }

    function validPresetShape(p) {
        if (!p || p.curveType !== "bezier") { return false; }
        if (p.anchors instanceof Array && p.anchors.length >= 2) { return true; }
        if (p.points instanceof Array && p.points.length === 4) { return true; }
        return false;
    }

    function loadLibrary() {
        userPresets = [];
        if (!fs || !ensureDir()) { return; }
        var files;
        try { files = fs.readdirSync(LIB_DIR); } catch (e) { return; }
        files.forEach(function (f) {
            if (!/\.json$/i.test(f)) { return; }
            try {
                var p = JSON.parse(fs.readFileSync(LIB_DIR + "/" + f, "utf8"));
                if (validPresetShape(p)) {
                    p._file = f;
                    userPresets.push(p);
                }
            } catch (e) {}
        });
        userPresets.sort(function (a, b) { return (a.createdAt || "") < (b.createdAt || "") ? -1 : 1; });
    }

    // always writes schema v2 (migrates v1 presets on their next write)
    function cleanPreset(p) {
        return {
            name: p.name,
            version: 2,
            curveType: "bezier",
            anchors: toCurve(p).anchors,
            createdAt: p.createdAt
        };
    }

    function writePreset(p) {
        if (!fs || !ensureDir()) { throw new Error("No filesystem access (cep_node missing)"); }
        var file = p._file || (slug(p.name) + "-" + Date.now() + ".json");
        fs.writeFileSync(LIB_DIR + "/" + file, JSON.stringify(cleanPreset(p), null, 2));
        p._file = file;
    }

    function deletePresetFile(p) {
        if (fs && p._file) {
            try { fs.unlinkSync(LIB_DIR + "/" + p._file); } catch (e) {}
        }
    }

    // ---------- rendering ----------
    function thumb(canvas, curve) {
        var ctx = canvas.getContext("2d");
        var dpr = window.devicePixelRatio || 1;
        var w = canvas.clientWidth || 60, h = canvas.clientHeight || 34;
        canvas.width = w * dpr; canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        var lo = 0, hi = 1;
        for (var j = 1; j < 16; j++) {
            var vv = C.valueAt(curve, j / 16);
            if (vv < lo) { lo = vv; }
            if (vv > hi) { hi = vv; }
        }
        var m = 0.1 * (hi - lo); lo -= m; hi += m;
        ctx.strokeStyle = "#31a8ff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var i = 0; i <= 48; i++) {
            var x = i / 48, v = C.valueAt(curve, x);
            var px = 3 + x * (w - 6);
            var py = h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
            if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
    }

    var showMineOnly = false;   // toggle "Meus" — mostra só os presets salvos pelo usuário
    function render() {
        gridEl.innerHTML = "";
        if (!showMineOnly) { BUILTINS.forEach(function (p) { gridEl.appendChild(cell(p, true)); }); }
        userPresets.forEach(function (p) { gridEl.appendChild(cell(p, false)); });
        if (showMineOnly && !userPresets.length) {
            var e = document.createElement("div"); e.className = "tree-empty";
            e.textContent = "Você ainda não salvou nenhum preset. Modele a curva e clique ＋ Salvar.";
            gridEl.appendChild(e);
        }
    }

    function cell(p, builtin) {
        var curve = toCurve(p);
        var el = document.createElement("div");
        el.className = "preset";
        el.dataset.key = C.canon(curve);
        var cv = document.createElement("canvas");
        el.appendChild(cv);
        var nm = document.createElement("div");
        nm.className = "pname";
        nm.textContent = p.name;
        nm.title = p.name;
        el.appendChild(nm);
        el.addEventListener("click", function () {
            window.EZApp.setCurve(curve);
            highlight(C.canon(curve));
            window.EZApp.status("Preset '" + p.name + "' carregado — 2×clique aplica");
        });
        // double-click = load AND apply in one motion
        el.addEventListener("dblclick", function () {
            window.EZApp.setCurve(curve);
            highlight(C.canon(curve));
            window.EZApp.apply();
        });
        if (!builtin) {
            el.addEventListener("contextmenu", function (e) {
                e.preventDefault();
                ctxMenu(e.clientX, e.clientY, p);
            });
        }
        setTimeout(function () { thumb(cv, curve); }, 0);
        return el;
    }

    function highlight(canonKey) {
        if (!gridEl) { return; }
        var cells = gridEl.querySelectorAll(".preset");
        for (var i = 0; i < cells.length; i++) {
            cells[i].classList.toggle("active", cells[i].dataset.key === canonKey);
        }
    }

    // right-click menu: rename / delete / export single
    function ctxMenu(x, y, p) {
        closeCtx();
        var m = document.createElement("div");
        m.className = "ctx-menu";
        m.id = "ctxMenu";
        [["Renomear", function () {
            var name = window.prompt("Renomear preset", p.name);
            if (!name) { return; }
            p.name = uniqueName(name.trim());
            writePreset(p);
            render();
        }],
        ["Excluir", function () {
            deletePresetFile(p);
            userPresets = userPresets.filter(function (q) { return q !== p; });
            render();
            window.EZApp.status("Preset '" + p.name + "' excluído");
        }],
        ["Exportar…", function () { exportSingle(p); }]
        ].forEach(function (item) {
            var d = document.createElement("div");
            d.textContent = item[0];
            d.addEventListener("click", function () { closeCtx(); item[1](); });
            m.appendChild(d);
        });
        m.style.left = Math.min(x, window.innerWidth - 130) + "px";
        m.style.top = Math.min(y, window.innerHeight - 100) + "px";
        document.body.appendChild(m);
        setTimeout(function () {
            window.addEventListener("mousedown", closeCtxOnOutside);
        }, 0);
    }
    function closeCtxOnOutside(e) {
        var m = document.getElementById("ctxMenu");
        if (m && !m.contains(e.target)) { closeCtx(); }
    }
    function closeCtx() {
        var m = document.getElementById("ctxMenu");
        if (m) { m.parentNode.removeChild(m); }
        window.removeEventListener("mousedown", closeCtxOnOutside);
    }

    // ---------- save / import / export ----------
    function saveCurrent() {
        var name = window.prompt("Nome do preset", "Meu easing");
        if (!name) { return; }
        var curve = C.norm(window.EZApp.getCurve());
        var p = {
            name: uniqueName(name.trim()),
            version: 2,
            curveType: "bezier",
            anchors: curve.anchors,
            createdAt: new Date().toISOString()
        };
        try {
            writePreset(p);
            userPresets.push(p);
            render();
            highlight(C.canon(curve));
            window.EZApp.status("Preset '" + p.name + "' salvo na biblioteca");
        } catch (e) {
            window.EZApp.status("Falha ao salvar: " + e.message, "err");
        }
    }

    function pickOpenPath() {
        try {
            var r = window.cep.fs.showOpenDialogEx(false, false, "Importar preset ou biblioteca",
                "", ["easify", "json"]);
            if (r && r.data && r.data.length) { return r.data[0]; }
        } catch (e) {}
        return null;
    }

    function pickSavePath(defaultName) {
        try {
            var r = window.cep.fs.showSaveDialogEx("Exportar", "", ["easify"], defaultName);
            if (r && r.data) { return r.data; }
        } catch (e) {}
        return null;
    }

    function importFile() {
        var file = pickOpenPath();
        if (!file || !fs) { return; }
        var doc;
        try { doc = JSON.parse(fs.readFileSync(file, "utf8")); }
        catch (e) { window.EZApp.status("Falha ao importar: JSON inválido", "err"); return; }

        var incoming = [];
        if (doc && doc.app === "easify" && doc.presets instanceof Array) {
            incoming = doc.presets;                       // library bundle (v1 or v2)
        } else if (doc && doc.curveType === "bezier") {
            incoming = [doc];                             // single preset (v1 or v2)
        } else {
            window.EZApp.status("Falha ao importar: não é um arquivo de preset/biblioteca válido", "err");
            return;
        }
        var added = 0, skipped = 0;
        incoming.forEach(function (p) {
            if (!validPresetShape(p)) { skipped++; return; }
            var q = {
                name: uniqueName(String(p.name || "Imported")),   // collision -> auto-suffix
                version: 2,
                curveType: "bezier",
                anchors: toCurve(p).anchors,
                createdAt: p.createdAt || new Date().toISOString()
            };
            try { writePreset(q); userPresets.push(q); added++; } catch (e) { skipped++; }
        });
        render();
        window.EZApp.status("Importado(s) " + added + " preset(s)" + (skipped ? ", pulado(s) " + skipped : ""));
    }

    function exportSingle(p) {
        var file = pickSavePath(slug(p.name) + ".easify");
        if (!file || !fs) { return; }
        if (!/\.easify$/i.test(file)) { file += ".easify"; }
        try {
            fs.writeFileSync(file, JSON.stringify(cleanPreset(p), null, 2));
            window.EZApp.status("Exportado '" + p.name + "' → " + file);
        } catch (e) { window.EZApp.status("Falha ao exportar: " + e.message, "err"); }
    }

    function exportLibrary() {
        if (!userPresets.length) { window.EZApp.status("Biblioteca vazia — salve um preset primeiro", "warn"); return; }
        var file = pickSavePath("easify-library.json");
        if (!file || !fs) { return; }
        var bundle = {
            app: "easify",
            version: 2,
            exportedAt: new Date().toISOString(),
            presets: userPresets.map(cleanPreset)
        };
        try {
            fs.writeFileSync(file, JSON.stringify(bundle, null, 2));
            window.EZApp.status("Exportados " + bundle.presets.length + " presets → " + file);
        } catch (e) { window.EZApp.status("Falha ao exportar: " + e.message, "err"); }
    }

    // ---------- public ----------
    root.EZPresets = {
        markCustom: function (curve) { highlight(C.canon(curve)); },
        libDir: LIB_DIR,
        _reload: function () { loadLibrary(); render(); }
    };

    document.addEventListener("DOMContentLoaded", function () {
        gridEl = document.getElementById("presetGrid");
        document.getElementById("presetSave").addEventListener("click", saveCurrent);
        document.getElementById("presetImport").addEventListener("click", importFile);
        document.getElementById("presetExport").addEventListener("click", exportLibrary);
        var mineBtn = document.getElementById("presetMine");
        if (mineBtn) {
            mineBtn.addEventListener("click", function () {
                showMineOnly = !showMineOnly;
                mineBtn.classList.toggle("active", showMineOnly);
                mineBtn.textContent = showMineOnly ? "Todos" : "Meus";
                render();
            });
        }
        loadLibrary();
        render();
    });
}(typeof self !== "undefined" ? self : this));
