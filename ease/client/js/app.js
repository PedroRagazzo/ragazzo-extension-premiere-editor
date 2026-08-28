/* Motion Ease panel controller: selection -> property tree -> keyframe strip ->
 * graph -> apply/revert. All curve math lives in EFCurves; all host access
 * in EZHost.
 *
 * Selection model:
 *  - click a property row  -> primary (its keys drive the strip + range)
 *  - checkboxes            -> which properties Apply bakes into; the "All"
 *                             box checks every listed property
 *  - nothing checked       -> Apply targets the primary row alone
 *  - the panel polls Premiere's selection signature (clip + total keys) and
 *    refreshes itself; primary + checks survive refreshes by property key
 *  - the filter box above the tree only appears when the list overflows
 *  - the keyframe strip only appears when the primary property has 3+ keys
 *    (that's when picking a start/end pair means something)
 */
(function () {
    "use strict";
    var C = window.EFCurves;
    var cs = new CSInterface();

    var $ = function (id) { return document.getElementById(id); };
    var statusEl = $("status");
    var treeEl = $("propTree");
    var stripSection = $("strip-section");
    var stripEl = $("kfStrip");
    var stripInfoEl = $("kfStripInfo");
    var clipNameEl = $("clipName");
    var searchEl = $("propSearch");
    var checkAllEl = $("checkAll");

    var state = {
        selection: null,       // EZ_getSelection payload
        primary: null,         // addr of the row whose keys are displayed
        checked: {},           // pkey -> true (Apply targets)
        rowIndex: {},          // pkey -> {comp, p} for ALL qualifying params
        keys: null,            // primary param keys {times, values}
        range: null,           // {i0, i1} into keys of chosen endpoints
        lastSnapshots: {},     // addrKey -> snapshot (session revert)
        applying: false,
        lastSig: null
    };

    // ---------------- status ----------------
    function status(msg, kind) {
        statusEl.textContent = msg;
        statusEl.className = "status " + (kind || "");
    }

    // ---------------- graph + readouts ----------------
    var graph = new EZGraph($("graph"), { onChange: onCurveChange });

    // ---- curve edit history (Ctrl/Cmd+Z / Shift+Z / Y) ----
    var history = { stack: [], index: -1, restoring: false, timer: null };
    function pushHistory(curve) {
        if (history.restoring) { return; }
        clearTimeout(history.timer);
        history.timer = setTimeout(function () {
            var key = C.canon(curve);
            if (history.index >= 0 && C.canon(history.stack[history.index]) === key) { return; }
            history.stack.length = history.index + 1;    // drop redo tail
            history.stack.push(C.norm(curve));
            if (history.stack.length > 60) { history.stack.shift(); }
            history.index = history.stack.length - 1;
        }, 350);
    }
    // A drag that hasn't hit the debounce yet isn't in the stack — commit it
    // before stepping, or the first undo would jump two states back.
    function commitPending() {
        clearTimeout(history.timer);
        var cur = graph.getCurve();
        if (history.index < 0 || C.canon(history.stack[history.index]) !== C.canon(cur)) {
            history.stack.length = history.index + 1;
            history.stack.push(C.norm(cur));
            history.index = history.stack.length - 1;
        }
    }
    function stepHistory(dir) {
        var target = history.index + dir;
        if (target < 0 || target >= history.stack.length) { return false; }
        history.index = target;
        history.restoring = true;
        graph.setCurve(history.stack[target]);
        history.restoring = false;
        return true;
    }

    function onCurveChange(curve) {
        var vel = C.toVelocity(curve);
        $("inflOut").value = vel.outgoing.influence.toFixed(1);
        $("spdOut").value = vel.outgoing.speed.toFixed(2);
        $("inflIn").value = vel.incoming.influence.toFixed(1);
        $("spdIn").value = vel.incoming.speed.toFixed(2);
        if (window.EZPresets) { window.EZPresets.markCustom(curve); }
        pushHistory(curve);
    }

    // Premiere swallows app-level shortcuts (Cmd/Ctrl+Z…) before the panel
    // sees them; a CEP panel must declare interest to receive them while
    // focused. Without this, undo/redo only worked for synthetic events.
    // NOTE: the bundled CSInterface.js predates the wrapper, so call the raw
    // CEP API (verified present in PPro 2026's CEP 12).
    try {
        var keyInterest = JSON.stringify([
            { keyCode: 90, metaKey: true },                   // cmd+Z
            { keyCode: 90, metaKey: true, shiftKey: true },   // cmd+shift+Z
            { keyCode: 90, ctrlKey: true },                   // ctrl+Z
            { keyCode: 90, ctrlKey: true, shiftKey: true },   // ctrl+shift+Z
            { keyCode: 89, ctrlKey: true },                   // ctrl+Y
            { keyCode: 89, metaKey: true },                   // cmd+Y
            { keyCode: 8 },                                   // backspace
            { keyCode: 46 }                                   // delete
        ]);
        if (typeof cs.registerKeyEventsInterest === "function") {
            cs.registerKeyEventsInterest(keyInterest);
        } else if (window.__adobe_cep__ && typeof window.__adobe_cep__.registerKeyEventsInterest === "function") {
            window.__adobe_cep__.registerKeyEventsInterest(keyInterest);
        }
    } catch (e) {}

    // keyboard shortcuts: undo/redo curve edits, delete the active mid anchor
    document.addEventListener("keydown", function (e) {
        var el = document.activeElement;
        var typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
        var mod = e.metaKey || e.ctrlKey;
        if (mod && (e.key === "z" || e.key === "Z")) {
            e.preventDefault();
            commitPending();
            if (e.shiftKey ? stepHistory(1) : stepHistory(-1)) {
                status(e.shiftKey ? "Refazer" : "Desfazer");
            }
            return;
        }
        if (mod && (e.key === "y" || e.key === "Y")) {
            e.preventDefault();
            commitPending();
            if (stepHistory(1)) { status("Refazer"); }
            return;
        }
        if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
            if (graph.deleteActiveAnchor()) {
                e.preventDefault();
                status("Ponto da curva removido");
            }
        }
    });

    function readVelocityInputs() {
        var vel = {
            outgoing: { influence: parseFloat($("inflOut").value), speed: parseFloat($("spdOut").value) },
            incoming: { influence: parseFloat($("inflIn").value), speed: parseFloat($("spdIn").value) }
        };
        if (isNaN(vel.outgoing.influence) || isNaN(vel.outgoing.speed) ||
            isNaN(vel.incoming.influence) || isNaN(vel.incoming.speed)) { return; }
        // pass the current curve so mid anchors survive endpoint-velocity edits
        graph.setCurve(C.fromVelocity(vel, graph.getCurve()));
    }
    ["inflOut", "spdOut", "inflIn", "spdIn"].forEach(function (id) {
        $(id).addEventListener("change", readVelocityInputs);
    });

    $("modeValue").addEventListener("click", function () { setMode("value"); });
    $("modeSpeed").addEventListener("click", function () { setMode("speed"); });
    function setMode(m) {
        graph.setMode(m);
        $("modeValue").className = m === "value" ? "seg active" : "seg";
        $("modeSpeed").className = m === "speed" ? "seg active" : "seg";
    }

    // preview animation loop (1.4s sweep + 0.5s hold)
    (function loop() {
        var period = 1900, sweep = 1400;
        var t = Date.now() % period;
        graph.setPreviewPhase(t < sweep ? t / sweep : 1);
        requestAnimationFrame(loop);
    }());

    // ---------------- selection / property tree ----------------
    function addrKey(addr) {
        return [addr.projectName, addr.seqName, addr.trackIndex, addr.clipIndex,
                addr.componentIndex, addr.paramIndex].join("/");
    }
    function pkeyOf(comp, p) { return comp.matchName + "::" + p.displayName; }

    function buildAddr(sel, comp, p) {
        return {
            projectName: null, // active project — the normal product case
            seqName: null,
            trackType: "video",
            trackIndex: sel.clip.trackIndex,
            clipIndex: sel.clip.clipIndex,
            clipName: sel.clip.name,
            componentIndex: comp.componentIndex,
            matchName: comp.matchName,
            paramIndex: p.paramIndex,
            paramName: p.displayName
        };
    }

    function refreshSelection(quiet) {
        return EZHost.call("EZ_getSelection").then(function (sel) {
            state.selection = sel;
            clipNameEl.textContent = sel.clip.name + "  (" + sel.sequence.name + ", " +
                sel.clip.fps.toFixed(2) + " fps)";
            var prevPrimary = state.primary ? state.primary.matchName + "::" + state.primary.paramName : null;
            renderTree(sel);
            restoreSelection(sel, prevPrimary);
            if (!state.primary && !quiet) {
                status("Escolha uma propriedade com keyframes; use as caixas pra aplicar em várias de uma vez.");
            }
        }).catch(function (e) {
            state.selection = null;
            state.primary = null;
            state.rowIndex = {};
            clipNameEl.textContent = "no clip";
            treeEl.innerHTML = "";
            state.keys = null;
            state.range = null;
            renderStrip();
            if (!quiet) { status(e.message, "err"); }
        });
    }
    $("refresh").addEventListener("click", function () { refreshSelection(false); });

    // Re-anchor primary + checks after a refresh; prune anything that no
    // longer exists (including the keyframe strip — it must never show a
    // previous clip's keys).
    function restoreSelection(sel, prevPrimaryPkey) {
        state.primary = null;
        var checkedStill = {};
        Object.keys(state.rowIndex).forEach(function (pk) {
            if (state.checked[pk]) { checkedStill[pk] = true; }
            if (pk === prevPrimaryPkey) {
                var e = state.rowIndex[pk];
                state.primary = buildAddr(sel, e.comp, e.p);
            }
        });
        state.checked = checkedStill;
        paintTree();
        // quiet: restoration is background bookkeeping — it must never stomp
        // whatever the status line currently says (e.g. an Apply result)
        if (state.primary) { loadKeys(true); }
        else { state.keys = null; state.range = null; renderStrip(); }
    }

    // Only properties that can actually take a curve (2+ keyframes) are
    // listed. rowIndex covers ALL qualifying params (not just the ones
    // passing the filter) so checks on filtered-out rows still apply.
    function renderTree(sel) {
        treeEl.innerHTML = "";
        state.rowIndex = {};
        var filter = searchEl.classList.contains("hidden") ? "" : searchEl.value.trim().toLowerCase();
        var shown = 0, qualifying = 0;
        sel.components.forEach(function (comp) {
            var kfParams = comp.params.filter(function (p) {
                return p.kfSupported && p.numKeys >= 2;
            });
            kfParams.forEach(function (p) {
                qualifying++;
                state.rowIndex[pkeyOf(comp, p)] = { comp: comp, p: p };
            });
            var visible = filter
                ? kfParams.filter(function (p) {
                    return (comp.displayName + " " + p.displayName).toLowerCase().indexOf(filter) !== -1;
                })
                : kfParams;
            if (!visible.length) { return; }
            var g = document.createElement("div");
            g.className = "tree-comp";
            var head = document.createElement("div");
            head.className = "tree-comp-name";
            head.textContent = comp.displayName;
            g.appendChild(head);
            visible.forEach(function (p) {
                shown++;
                var pk = pkeyOf(comp, p);
                var row = document.createElement("div");
                row.className = "tree-param";
                row.dataset.pkey = pk;

                var box = document.createElement("input");
                box.type = "checkbox";
                box.checked = !!state.checked[pk];
                box.title = "Incluir no Aplicar";
                box.addEventListener("click", function (e) { e.stopPropagation(); });
                box.addEventListener("change", function () {
                    if (box.checked) { state.checked[pk] = true; }
                    else { delete state.checked[pk]; }
                    syncCheckAll();
                    countStatus();
                });
                row.appendChild(box);

                var label = document.createElement("span");
                label.className = "pname-label";
                label.textContent = p.displayName;
                row.appendChild(label);

                var badge = document.createElement("span");
                badge.className = "badge";
                badge.textContent = p.numKeys + " keys";
                row.appendChild(badge);

                row.addEventListener("click", function () {
                    state.primary = buildAddr(sel, comp, p);
                    paintTree();
                    loadKeys();
                });
                g.appendChild(row);
            });
            treeEl.appendChild(g);
        });
        if (!shown) {
            var empty = document.createElement("div");
            empty.className = "tree-empty";
            empty.textContent = filter
                ? "Nenhuma propriedade combina com ‘" + filter + "’"
                : "Nenhuma propriedade com 2+ keyframes neste clipe — crie dois keyframes no Controle de Efeitos primeiro. " +
                  "Obs.: o Remapeamento de Tempo não aparece na lista — o Premiere não o expõe a nenhum plugin (limitação da API da Adobe).";
            treeEl.appendChild(empty);
        }
        paintTree();
        // the filter box only exists when the list is long enough to scroll
        var overflows = treeEl.scrollHeight > treeEl.clientHeight + 2;
        var keepForTyping = !searchEl.classList.contains("hidden") && searchEl.value !== "";
        searchEl.classList.toggle("hidden", !(overflows || keepForTyping));
    }

    searchEl.addEventListener("input", function () {
        if (state.selection) { renderTree(state.selection); }
    });

    checkAllEl.addEventListener("change", function () {
        if (checkAllEl.checked) {
            Object.keys(state.rowIndex).forEach(function (pk) { state.checked[pk] = true; });
        } else {
            state.checked = {};
        }
        paintTree();
        countStatus();
    });

    function syncCheckAll() {
        var all = Object.keys(state.rowIndex);
        var n = all.filter(function (pk) { return state.checked[pk]; }).length;
        checkAllEl.checked = all.length > 0 && n === all.length;
        checkAllEl.indeterminate = n > 0 && n < all.length;
    }

    function countStatus() {
        var n = Object.keys(state.checked).filter(function (pk) { return state.rowIndex[pk]; }).length;
        if (n > 1) { status(n + " propriedades marcadas — o Aplicar grava a curva em todas."); }
    }

    function paintTree() {
        var primPk = state.primary ? state.primary.matchName + "::" + state.primary.paramName : null;
        var rows = treeEl.querySelectorAll(".tree-param");
        for (var i = 0; i < rows.length; i++) {
            var pk = rows[i].dataset.pkey;
            rows[i].classList.toggle("sel", pk === primPk);
            rows[i].classList.toggle("prim", pk === primPk);
            var box = rows[i].querySelector("input[type=checkbox]");
            if (box) { box.checked = !!state.checked[pk]; }
        }
        syncCheckAll();
    }

    // quietStatus: refresh strip/keys without overwriting the status line
    // (used right after Apply/Revert so their result message stays visible)
    function loadKeys(quietStatus) {
        if (!state.primary) { return; }
        var prim = state.primary;
        EZHost.call("EZ_getKeys", prim).then(function (res) {
            state.keys = res;
            if (!res.timeVarying || res.times.length < 2) {
                state.range = null;
                renderStrip();
                if (!quietStatus) {
                    status("'" + prim.paramName + "' precisa de pelo menos 2 keyframes — crie-os no Premiere primeiro.", "warn");
                }
                return;
            }
            state.range = { i0: 0, i1: res.times.length - 1 }; // default: first/last
            renderStrip();
            if (!quietStatus) {
                status("Trecho: " + fmtT(res.times[state.range.i0]) + " → " + fmtT(res.times[state.range.i1]) +
                       ". Modele a curva e clique Aplicar.");
            }
        }).catch(function (e) {
            state.keys = null;
            state.range = null;
            renderStrip();
            status(e.message, "err");
        });
    }

    function fmtT(s) { return s.toFixed(2) + "s"; }

    // ---------------- keyframe strip (endpoint pair picker, primary param) ----
    // Only shown when the primary param has 3+ keys — with exactly 2 there is
    // no pair to pick, and an empty strip just looks like a dead search bar.
    function renderStrip() {
        stripEl.innerHTML = "";
        var k = state.keys;
        var useful = !!(k && k.timeVarying && k.times.length >= 3);
        stripSection.classList.toggle("hidden", !useful);
        if (!useful) {
            stripInfoEl.textContent = "";
            return;
        }
        var lo = k.times[0], hi = k.times[k.times.length - 1];
        var span = Math.max(hi - lo, 0.0001);
        k.times.forEach(function (t, i) {
            var dot = document.createElement("div");
            dot.className = "kf";
            if (state.range && i >= state.range.i0 && i <= state.range.i1) { dot.classList.add("inRange"); }
            if (state.range && (i === state.range.i0 || i === state.range.i1)) { dot.classList.add("endpoint"); }
            dot.style.left = (2 + 96 * (t - lo) / span) + "%";
            dot.title = fmtT(t);
            dot.addEventListener("click", function () { pickEndpoint(i); });
            stripEl.appendChild(dot);
        });
        stripInfoEl.textContent = (state.primary ? state.primary.paramName + " — " : "") + (state.range
            ? ((state.range.i1 - state.range.i0) === k.times.length - 1 && state.range.i0 === 0
                ? "full range (first → last key)"
                : "custom range: key " + (state.range.i0 + 1) + " → key " + (state.range.i1 + 1))
            : "");
    }

    // click-twice picker: first click = start, second (later key) = end
    var pickPending = null;
    function pickEndpoint(i) {
        var n = state.keys.times.length;
        if (pickPending === null) {
            pickPending = i;
            state.range = { i0: i, i1: i };
        } else {
            var a = Math.min(pickPending, i), b = Math.max(pickPending, i);
            if (a === b) { a = 0; b = n - 1; } // same key twice = reset to full
            state.range = { i0: a, i1: b };
            pickPending = null;
        }
        renderStrip();
        if (state.range.i0 !== state.range.i1) {
            status("Trecho: " + fmtT(state.keys.times[state.range.i0]) + " → " +
                   fmtT(state.keys.times[state.range.i1]));
        } else {
            status("Agora clique no keyframe final do trecho…");
        }
    }

    // ---------------- apply / revert ----------------
    function sampleCount(t0, t1) {
        // one baked key per frame — dense enough for bounces, cheap to write
        var fps = state.selection ? state.selection.clip.fps : 30;
        var n = Math.floor((t1 - t0) * fps) - 1;
        return Math.max(3, Math.min(n, 600));
    }

    function buildSamples(curve, t0, t1, v0, v1, dims) {
        var n = sampleCount(t0, t1);
        return C.sample(curve, n).map(function (s) {
            var v;
            if (dims > 1) {
                v = [];
                for (var d = 0; d < dims; d++) { v.push(v0[d] + s.value * (v1[d] - v0[d])); }
            } else {
                v = v0 + s.value * (v1 - v0);
            }
            return { t: t0 + s.time * (t1 - t0), v: v };
        });
    }

    // What Apply/Revert operate on: every checked property, or the primary
    // row when nothing is checked.
    function applyTargets() {
        var sel = state.selection;
        if (!sel) { return []; }
        var targets = [];
        Object.keys(state.checked).forEach(function (pk) {
            var e = state.rowIndex[pk];
            if (e) { targets.push(buildAddr(sel, e.comp, e.p)); }
        });
        if (!targets.length && state.primary) { targets.push(state.primary); }
        return targets;
    }

    function applyToAddr(addr, curve, useCustomRange, done) {
        // re-read keys at apply time: endpoint values are host truth
        EZHost.call("EZ_getKeys", addr).then(function (res) {
            if (!res.timeVarying || res.times.length < 2) {
                throw new Error("'" + addr.paramName + "' has fewer than 2 keyframes");
            }
            var i0 = 0, i1 = res.times.length - 1;
            if (useCustomRange && state.range && state.keys &&
                res.times.length === state.keys.times.length) {
                i0 = state.range.i0; i1 = state.range.i1;
            }
            var t0 = res.times[i0], t1 = res.times[i1];
            var v0 = res.values[i0], v1 = res.values[i1];
            var dims = (v0 instanceof Array) ? v0.length : 1;
            var snapshotId = addrKey(addr) + "@" + Date.now();
            return EZHost.call("EZ_apply", {
                addr: addr,
                snapshotId: snapshotId,
                t0: t0, t1: t1,
                samples: buildSamples(curve, t0, t1, v0, v1, dims),
                setEndpointInterp: true,
                // AE engine: 2-anchor curves become TRUE temporal ease on the
                // endpoint keys (no baking). Premiere engine ignores these.
                anchorCount: C.norm(curve).anchors.length,
                vel: C.toVelocity(curve)
            });
        }).then(function (res) {
            state.lastSnapshots[addrKey(addr)] = res.snapshot;
            persistSnapshots();
            done(null, res);
        }).catch(function (e) { done(e); });
    }

    // sequentially apply the current curve to a list of addrs
    function applyMany(targets, curve, onDone) {
        var i = 0, okCount = 0, errs = [], totalKeys = 0, totalMs = 0;
        var primPk = state.primary ? state.primary.matchName + "::" + state.primary.paramName : null;
        (function next() {
            if (i >= targets.length) {
                onDone(okCount, errs, totalKeys, totalMs);
                return;
            }
            var tgt = targets[i++];
            if (targets.length > 1) {
                status("Aplicando em " + tgt.paramName + " (" + i + "/" + targets.length + ")…");
            }
            var isPrimaryOnly = targets.length === 1 &&
                (tgt.matchName + "::" + tgt.paramName) === primPk;
            applyToAddr(tgt, curve, isPrimaryOnly, function (err, res) {
                if (err) { errs.push(tgt.paramName + ": " + err.message); }
                else { okCount++; totalKeys += res.keysWritten; totalMs += res.ms; }
                next();
            });
        }());
    }

    // shared by the Apply button and preset double-click
    function doApply() {
        if (state.applying) { return; }
        var targets = applyTargets();
        if (!targets.length) {
            status("Escolha uma propriedade primeiro (clique numa linha ou use as caixas)", "warn");
            return;
        }
        state.applying = true;
        status("Aplicando…");
        applyMany(targets, graph.getCurve(), function (okCount, errs, keys, ms) {
            state.applying = false;
            if (errs.length && !okCount) {
                status("Falha ao aplicar: " + errs.join("; "), "err");
            } else if (errs.length) {
                status("Aplicado em " + okCount + "/" + (okCount + errs.length) +
                       " — falhou: " + errs.join("; "), "warn");
            } else {
                status("Aplicado — " + keys + " keyframes em " + okCount +
                       " propriedade" + (okCount === 1 ? "" : "s") + " em " + ms + "ms. Dá pra Desfazer.", "okk");
            }
            if (state.primary) { loadKeys(true); }
        });
    }
    $("apply").addEventListener("click", doApply);

    $("revert").addEventListener("click", function () {
        if (state.applying) { return; }
        var candidates = applyTargets();
        if (!candidates.length) { status("Escolha uma propriedade primeiro", "warn"); return; }
        var targets = candidates.filter(function (a) { return state.lastSnapshots[addrKey(a)]; });
        if (!targets.length) {
            status("Nada para desfazer na" +
                   (candidates.length === 1 ? " propriedade" : "s propriedades") + " nesta sessão", "warn");
            return;
        }
        state.applying = true;
        var i = 0, okCount = 0, errs = [];
        (function next() {
            if (i >= targets.length) {
                state.applying = false;
                status(errs.length
                    ? "Desfeito em " + okCount + "/" + targets.length + " — falhou: " + errs.join("; ")
                    : "Desfeito em " + okCount + " propriedade" + (okCount === 1 ? "" : "s") + ".",
                    errs.length ? "warn" : "okk");
                if (state.primary) { loadKeys(true); }
                return;
            }
            var addr = targets[i++];
            EZHost.call("EZ_revert", { addr: addr, snapshot: state.lastSnapshots[addrKey(addr)] })
                .then(function () {
                    delete state.lastSnapshots[addrKey(addr)];
                    persistSnapshots();
                    okCount++;
                    next();
                }).catch(function (e) { errs.push(addr.paramName + ": " + e.message); next(); });
        }());
    });

    // snapshots survive panel reloads within the Premiere session
    function persistSnapshots() {
        try { window.sessionStorage.setItem("ez.snapshots", JSON.stringify(state.lastSnapshots)); }
        catch (e) {}
    }
    try {
        var saved = window.sessionStorage.getItem("ez.snapshots");
        if (saved) { state.lastSnapshots = JSON.parse(saved); }
    } catch (e) {}

    // ---------------- resizable sections (Premiere-style dividers) ----------
    (function initSplitters() {
        var layout = {};
        try { layout = JSON.parse(window.localStorage.getItem("ez.layout") || "{}"); } catch (e) {}
        function save() {
            try { window.localStorage.setItem("ez.layout", JSON.stringify(layout)); } catch (e) {}
        }
        function wire(splitId, targetEl, key, min, max, onResize) {
            var split = $(splitId);
            if (layout[key]) {
                targetEl.style.height = Math.max(min, Math.min(max, layout[key])) + "px";
                if (onResize) { onResize(); }
            }
            split.addEventListener("mousedown", function (e) {
                e.preventDefault();
                split.classList.add("dragging");
                var startY = e.clientY;
                var startH = targetEl.getBoundingClientRect().height;
                function move(ev) {
                    var h = Math.max(min, Math.min(max, startH + (ev.clientY - startY)));
                    targetEl.style.height = h + "px";
                    layout[key] = h;
                    if (onResize) { onResize(); }
                }
                function up() {
                    split.classList.remove("dragging");
                    window.removeEventListener("mousemove", move);
                    window.removeEventListener("mouseup", up);
                    save();
                }
                window.addEventListener("mousemove", move);
                window.addEventListener("mouseup", up);
            });
        }
        wire("splitTree", $("propTree"), "tree", 60, 320, null);
        wire("splitGraph", $("graph"), "graph", 120, 480, function () { graph.resize(); });
    }());

    // ---------------- selection auto-refresh ----------------
    // Poll a cheap host-side signature; on change, re-read the clip and
    // restore the picked properties. Manual ⟳ stays for force-refresh.
    function pollSignature() {
        if (state.applying) { return; }
        EZHost.call("EZ_getSelectionSignature").then(function (res) {
            if (res.sig !== state.lastSig) {
                state.lastSig = res.sig;
                refreshSelection(true);
            }
        }).catch(function () { /* keep polling */ });
    }
    setInterval(pollSignature, 2000);

    // ---------------- check for updates ----------------
    // The panel embeds its own version and compares it against a small JSON
    // manifest hosted online. If a newer version is published, the header
    // button turns into a download link. Buyers always re-download the latest
    // build free from their Gumroad library; this is the in-panel nudge.
    //
    // Publishing an update: upload the new build to the Gumroad product AND
    // update the hosted manifest (see packaging/version.json) to the new
    // version number. Host it at UPDATE_MANIFEST_URL.
    var EZ_APP_VERSION = "1.0.2";
    var UPDATE_MANIFEST_URL = "https://motionease-updates.netlify.app/version.json";
    var DOWNLOAD_URL = "https://colden.gumroad.com/l/motion-ease";
    var updateUrl = null; // set when a newer version is found

    function cmpVersion(a, b) {
        var pa = String(a).split("."), pb = String(b).split(".");
        for (var i = 0; i < Math.max(pa.length, pb.length); i++) {
            var na = parseInt(pa[i] || "0", 10), nb = parseInt(pb[i] || "0", 10);
            if (na > nb) { return 1; }
            if (na < nb) { return -1; }
        }
        return 0;
    }

    function httpsGetJSON(url, cb) {
        var https;
        try { https = window.cep_node ? window.cep_node.require("https") : require("https"); }
        catch (e) { cb(new Error("no network module")); return; }
        var done = false;
        var finish = function (err, data) { if (!done) { done = true; cb(err, data); } };
        try {
            var req = https.get(url, function (res) {
                if (res.statusCode >= 300) { res.resume(); finish(new Error("HTTP " + res.statusCode)); return; }
                var body = "";
                res.on("data", function (c) { body += c; });
                res.on("end", function () {
                    try { finish(null, JSON.parse(body)); } catch (e) { finish(new Error("bad JSON")); }
                });
            });
            req.on("error", function (e) { finish(e); });
            req.setTimeout(8000, function () { req.destroy(); finish(new Error("timeout")); });
        } catch (e) { finish(e); }
    }

    // manual=true writes full status feedback; on the silent boot check we
    // only flip the button (no status noise over the selection prompt).
    function checkForUpdates(manual) {
        var btn = $("checkUpdate");
        if (manual) { status("Checking for updates…"); }
        httpsGetJSON(UPDATE_MANIFEST_URL, function (err, data) {
            if (err || !data || !data.version) {
                if (manual) { status("Couldn't check for updates (" + (err ? err.message : "no data") + ").", "warn"); }
                return;
            }
            if (cmpVersion(data.version, EZ_APP_VERSION) > 0) {
                updateUrl = data.url || DOWNLOAD_URL;
                btn.textContent = "Update ▸";
                btn.classList.add("available");
                btn.title = "Version " + data.version + " is available — click to download";
                if (manual) {
                    status("Update available: v" + data.version +
                           (data.notes ? " — " + data.notes : "") + ". Click Update to download.", "okk");
                }
            } else {
                updateUrl = null;
                btn.textContent = "v" + EZ_APP_VERSION;
                btn.classList.remove("available");
                if (manual) { status("You're on the latest version (v" + EZ_APP_VERSION + ").", "okk"); }
            }
        });
    }

    (function initUpdates() {
        var btn = $("checkUpdate");
        if (!btn) { return; }
        btn.textContent = "v" + EZ_APP_VERSION;
        btn.addEventListener("click", function () {
            if (updateUrl) { try { cs.openURLInDefaultBrowser(updateUrl); } catch (e) {} }
            else { checkForUpdates(true); }
        });
        // silent check shortly after boot
        setTimeout(function () { checkForUpdates(false); }, 1500);
    }());

    // ---------------- boot ----------------
    window.EZApp = {
        setCurve: function (c) { graph.setCurve(c); },
        getCurve: function () { return graph.getCurve(); },
        apply: doApply,
        status: status,
        _graph: graph, // exposed for the CDP-driven UI tests (scripts/test-ui.js)
        _state: state,
        _checkForUpdates: checkForUpdates // test hook
    };

    setMode("value");
    onCurveChange(graph.getCurve());
    window.addEventListener("resize", function () { graph.resize(); });

    EZHost.call("EZ_ping").then(function () {
        refreshSelection(false);
    }).catch(function (e) {
        status("O motor do host não respondeu: " + e.message, "err");
    });
}());
