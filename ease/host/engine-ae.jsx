// Motion Ease keyframe engine — AFTER EFFECTS host. ES3 ExtendScript.
//
// Same contract as engine.jsx (the Premiere engine): every public EZ_*
// function takes ONE JSON-string argument and returns a JSON string
// {ok:true,...} / {ok:false, error}. The panel is host-agnostic; host-bridge
// picks this file when it detects AEFT.
//
// Premiere-concept mapping:
//   clip            -> selected Layer in the active CompItem
//   trackIndex      -> layer.index (AE is 1-based; treated as opaque by panel)
//   clipIndex       -> always 0
//   component       -> Transform group | each effect | Time Remap (AE exposes
//                      time remapping to scripting — Premiere does not!)
//   param           -> animatable Property inside that group (filtered list;
//                      paramIndex indexes the FILTERED list, validated by name)
//
// Apply strategy (better than Premiere allows):
//   - 2-anchor curves (plain cubic bezier): set REAL temporal ease on the two
//     endpoint keys via KeyframeEase — no baked keys, stays editable in AE's
//     own graph editor. This is what AE users expect (Flow-style).
//   - multi-anchor curves (Bounce/Elastic): bake dense linear keys between
//     the endpoints, same as the Premiere engine.
//   - any error in the ease path falls back to baking.

var EZ_ENGINE_VERSION = "1.1.0-ae";

if (typeof $.global.EZ_SNAPSHOTS === "undefined") { $.global.EZ_SNAPSHOTS = {}; }

// ---- self-contained JSON --------------------------------------------------------
// AE 2026's built-in ExtendScript JSON object is BROKEN (stringify emits
// '{: ,: ,: }' — empty keys and values), and json2.jsx skips redefining an
// existing JSON. Never trust the host's JSON here; EZJ is used throughout.
var EZJ = {
    stringify: function s(v) {
        var t = typeof v, i, out;
        if (v === null || v === undefined) { return "null"; }
        if (t === "number") { return isFinite(v) ? String(v) : "null"; }
        if (t === "boolean") { return String(v); }
        if (t === "string") {
            var r = "";
            for (i = 0; i < v.length; i++) {
                var c = v.charAt(i), code = v.charCodeAt(i);
                if (c === '"') { r += '\\"'; }
                else if (c === "\\") { r += "\\\\"; }
                else if (c === "\n") { r += "\\n"; }
                else if (c === "\r") { r += "\\r"; }
                else if (c === "\t") { r += "\\t"; }
                else if (code < 32) { r += "\\u" + ("000" + code.toString(16)).slice(-4); }
                else { r += c; }
            }
            return '"' + r + '"';
        }
        if (v instanceof Array) {
            out = [];
            for (i = 0; i < v.length; i++) { out.push(s(v[i])); }
            return "[" + out.join(",") + "]";
        }
        if (t === "object") {
            out = [];
            for (var k in v) {
                if (v.hasOwnProperty(k) && typeof v[k] !== "function" && v[k] !== undefined) {
                    out.push(s(String(k)) + ":" + s(v[k]));
                }
            }
            return "{" + out.join(",") + "}";
        }
        return "null";
    },
    // input is always produced by our own panel/engine — eval is safe & ES3-proof
    parse: function (text) { return eval("(" + text + ")"); }
};

function EZ__err(e) {
    var m = "";
    try { m = (e && e.message) ? e.message : String(e); } catch (x) { m = "unstringifiable error"; }
    if (e && e.line) { m += " (jsx line " + e.line + ")"; }
    return m;
}

function EZ__fail(msg) { return EZJ.stringify({ ok: false, error: msg }); }

function EZ__safeVal(v) {
    if (v === null || v === undefined) { return null; }
    var t = typeof v;
    if (t === "number" || t === "string" || t === "boolean") { return v; }
    if (v instanceof Array) {
        var out = [];
        for (var i = 0; i < v.length; i++) { out.push(EZ__safeVal(v[i])); }
        return out;
    }
    try { return String(v); } catch (e) { return "unstringifiable"; }
}

function EZ__activeComp() {
    if (!app.project) { throw new Error("No project open"); }
    var item = app.project.activeItem;
    if (!item || !(item instanceof CompItem)) {
        throw new Error("No active composition — open a comp in the Timeline");
    }
    return item;
}

function EZ__selectedLayer(comp) {
    var sel = comp.selectedLayers;
    if (!sel || sel.length === 0) {
        throw new Error("Select a layer in the composition, then hit refresh");
    }
    return sel[0];
}

// A property qualifies if AE can animate it and it holds plain numeric data.
function EZ__paramOk(p) {
    if (p.propertyType !== PropertyType.PROPERTY) { return false; }
    if (!p.canVaryOverTime) { return false; }
    var vt = p.propertyValueType;
    return vt === PropertyValueType.OneD ||
           vt === PropertyValueType.TwoD || vt === PropertyValueType.TwoD_SPATIAL ||
           vt === PropertyValueType.ThreeD || vt === PropertyValueType.ThreeD_SPATIAL ||
           vt === PropertyValueType.COLOR;
}

// Deterministic component list for a layer: Transform, then each effect in
// order, then Time Remap when enabled. Rebuilt identically on every call;
// addr name checks catch drift (effect added/removed between calls).
function EZ__componentGroups(layer) {
    var groups = [];
    try {
        if (layer.transform) {
            groups.push({ group: layer.transform, displayName: "Transform",
                          matchName: "ADBE Transform Group" });
        }
    } catch (e1) {}
    try {
        var fx = layer.property("ADBE Effect Parade");
        if (fx) {
            for (var i = 1; i <= fx.numProperties; i++) {
                var g = fx.property(i);
                groups.push({ group: g, displayName: g.name, matchName: g.matchName });
            }
        }
    } catch (e2) {}
    try {
        if (layer.canSetTimeRemapEnabled && layer.timeRemapEnabled) {
            groups.push({ group: null, displayName: "Time",
                          matchName: "EZ Time Remap",
                          soleParam: layer.property("ADBE Time Remapping") });
        }
    } catch (e3) {}
    return groups;
}

function EZ__groupParams(entry) {
    if (entry.soleParam) { return [entry.soleParam]; }
    var out = [];
    for (var i = 1; i <= entry.group.numProperties; i++) {
        var p = entry.group.property(i);
        try { if (EZ__paramOk(p)) { out.push(p); } } catch (e) {}
    }
    return out;
}

function EZ__resolveLayer(addr) {
    var comp = EZ__activeComp();
    if (addr.trackIndex < 1 || addr.trackIndex > comp.numLayers) {
        throw new Error("Layer " + addr.trackIndex + " no longer exists");
    }
    var layer = comp.layer(addr.trackIndex);
    if (addr.clipName && layer.name !== addr.clipName) {
        throw new Error("Layer at that position is now '" + layer.name + "', expected '" +
                        addr.clipName + "' — reselect the layer and refresh");
    }
    return layer;
}

function EZ__resolveParam(addr) {
    var layer = EZ__resolveLayer(addr);
    var groups = EZ__componentGroups(layer);
    if (addr.componentIndex < 0 || addr.componentIndex >= groups.length) {
        throw new Error("Component " + addr.componentIndex + " no longer exists (effect removed?)");
    }
    var entry = groups[addr.componentIndex];
    var params = EZ__groupParams(entry);
    if (addr.paramIndex < 0 || addr.paramIndex >= params.length) {
        throw new Error("Param " + addr.paramIndex + " no longer exists");
    }
    var param = params[addr.paramIndex];
    if (addr.paramName && param.name !== addr.paramName) {
        throw new Error("Param at that position is now '" + param.name +
                        "', expected '" + addr.paramName + "' — refresh the property list");
    }
    return param;
}

function EZ__keyTimes(param) {
    var out = [];
    for (var i = 1; i <= param.numKeys; i++) { out.push(param.keyTime(i)); }
    return out;
}

// nearest key index at time t (within eps), or 0
function EZ__keyIndexAt(param, t, eps) {
    if (param.numKeys === 0) { return 0; }
    var i = param.nearestKeyIndex(t);
    return (Math.abs(param.keyTime(i) - t) <= eps) ? i : 0;
}

function EZ_ping() {
    return EZJ.stringify({ ok: true, engine: EZ_ENGINE_VERSION, app: "AE " + app.version });
}

function EZ_getSelectionSignature() {
    try {
        var comp = EZ__activeComp();
        var sel = comp.selectedLayers;
        var found = "", keySum = 0;
        if (sel && sel.length) {
            var layer = sel[0];
            found = layer.name + "@" + layer.index;
            var groups = EZ__componentGroups(layer);
            for (var g = 0; g < groups.length; g++) {
                var params = EZ__groupParams(groups[g]);
                for (var p = 0; p < params.length; p++) {
                    try { keySum += params[p].numKeys; } catch (eK) {}
                }
            }
        }
        return EZJ.stringify({ ok: true, sig: comp.id + "|" + found + "|k" + keySum });
    } catch (e) {
        return EZJ.stringify({ ok: true, sig: "no-comp" });
    }
}

function EZ_getSelection() {
    try {
        var comp = EZ__activeComp();
        var layer = EZ__selectedLayer(comp);
        var fps = 1 / comp.frameDuration;

        var components = [];
        var groups = EZ__componentGroups(layer);
        for (var g = 0; g < groups.length; g++) {
            var params = EZ__groupParams(groups[g]);
            var list = [];
            for (var pi = 0; pi < params.length; pi++) {
                var p = params[pi];
                var numKeys = 0, val = null, dims = 1;
                try { numKeys = p.numKeys; } catch (e1) {}
                try {
                    val = p.value;
                    if (val instanceof Array) { dims = val.length; }
                } catch (e2) {}
                list.push({
                    paramIndex: pi,
                    displayName: p.name,
                    kfSupported: true,
                    timeVarying: numKeys > 0,
                    numKeys: numKeys,
                    dims: dims,
                    value: EZ__safeVal(val)
                });
            }
            components.push({
                componentIndex: g,
                displayName: groups[g].displayName,
                matchName: groups[g].matchName,
                params: list
            });
        }

        return EZJ.stringify({
            ok: true,
            clip: {
                name: layer.name,
                trackType: "video",
                trackIndex: layer.index,   // 1-based; opaque to the panel
                clipIndex: 0,
                start: layer.inPoint,
                end: layer.outPoint,
                fps: fps
            },
            sequence: { name: comp.name, fps: fps },
            components: components
        });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}

function EZ_getKeys(argJson) {
    try {
        var addr = EZJ.parse(argJson);
        var param = EZ__resolveParam(addr);
        if (param.numKeys === 0) {
            return EZJ.stringify({ ok: true, timeVarying: false, times: [], values: [] });
        }
        var times = [], values = [];
        for (var i = 1; i <= param.numKeys; i++) {
            times.push(param.keyTime(i));
            values.push(EZ__safeVal(param.keyValue(i)));
        }
        return EZJ.stringify({ ok: true, timeVarying: true, times: times, values: values });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}

// ---- apply ----------------------------------------------------------------------
// arg: { addr, snapshotId, t0, t1, samples:[{t,v}], setEndpointInterp,
//        vel: {outgoing:{influence,speed}, incoming:{...}},  // normalized
//        anchorCount }                                        // 2 = pure bezier
// 2-anchor + vel -> true temporal ease on the endpoint keys (no baking).
// Otherwise -> bake linear keys exactly like the Premiere engine.

function EZ__removeInside(param, t0, t1, eps) {
    for (var i = param.numKeys; i >= 1; i--) {
        var kt = param.keyTime(i);
        if (kt > t0 + eps && kt < t1 - eps) { param.removeKey(i); }
    }
}

function EZ__snapshotRange(param, t0, t1, eps) {
    var times = [], values = [];
    for (var i = 1; i <= param.numKeys; i++) {
        var kt = param.keyTime(i);
        if (kt >= t0 - eps && kt <= t1 + eps) {
            times.push(kt);
            values.push(EZ__safeVal(param.keyValue(i)));
        }
    }
    return { times: times, values: values };
}

// per-ease-dimension value deltas over the span, for normalized->real speed
function EZ__easeDeltas(param, k0, k1, easeDims) {
    var v0 = param.keyValue(k0), v1 = param.keyValue(k1);
    var deltas = [], d;
    if (v0 instanceof Array) {
        if (easeDims === v0.length) {
            for (d = 0; d < easeDims; d++) { deltas.push(v1[d] - v0[d]); }
        } else {
            var sum = 0;
            for (d = 0; d < v0.length; d++) { sum += (v1[d] - v0[d]) * (v1[d] - v0[d]); }
            var mag = Math.sqrt(sum);
            for (d = 0; d < easeDims; d++) { deltas.push(mag); }
        }
    } else {
        for (d = 0; d < easeDims; d++) { deltas.push(v1 - v0); }
    }
    return deltas;
}

function EZ__applyTrueEase(param, t0, t1, vel, eps) {
    var k0 = EZ__keyIndexAt(param, t0, eps);
    var k1 = EZ__keyIndexAt(param, t1, eps);
    if (!k0 || !k1) { throw new Error("endpoint keys not found for ease"); }

    param.setInterpolationTypeAtKey(k0, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
    param.setInterpolationTypeAtKey(k1, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);

    var easeDims = param.keyOutTemporalEase(k0).length;
    var span = t1 - t0;
    var deltas = EZ__easeDeltas(param, k0, k1, easeDims);

    function clampInf(x) { return Math.max(0.1, Math.min(100, x)); }
    function easeArr(slope, influence) {
        var arr = [];
        for (var d = 0; d < easeDims; d++) {
            arr.push(new KeyframeEase(slope * deltas[d] / span, clampInf(influence)));
        }
        return arr;
    }

    // k0: keep its incoming ease, set outgoing from the curve's start velocity
    param.setTemporalEaseAtKey(k0, param.keyInTemporalEase(k0),
        easeArr(vel.outgoing.speed, vel.outgoing.influence));
    // k1: set incoming from the curve's end velocity, keep its outgoing ease
    param.setTemporalEaseAtKey(k1, easeArr(vel.incoming.speed, vel.incoming.influence),
        param.keyOutTemporalEase(k1));
}

function EZ__applyBake(param, arg, t0, t1, eps) {
    var n = arg.samples.length, written = 0;
    for (var k = 0; k < n; k++) {
        var s = arg.samples[k];
        var t = Number(s.t);
        if (t <= t0 + eps || t >= t1 - eps) { continue; }
        param.setValueAtTime(t, s.v);
        written++;
    }
    // make every baked key linear so playback matches the sampled curve
    for (var i = 1; i <= param.numKeys; i++) {
        var kt = param.keyTime(i);
        if (kt > t0 + eps && kt < t1 - eps) {
            try {
                param.setInterpolationTypeAtKey(i,
                    KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
            } catch (eL) {}
        }
    }
    if (arg.setEndpointInterp) {
        var k0 = EZ__keyIndexAt(param, t0, eps), k1 = EZ__keyIndexAt(param, t1, eps);
        try {
            if (k0) { param.setInterpolationTypeAtKey(k0, param.keyInInterpolationType(k0), KeyframeInterpolationType.LINEAR); }
            if (k1) { param.setInterpolationTypeAtKey(k1, KeyframeInterpolationType.LINEAR, param.keyOutInterpolationType(k1)); }
        } catch (eE) {}
    }
    return written;
}

function EZ_apply(argJson) {
    try {
        var arg = EZJ.parse(argJson);
        var param = EZ__resolveParam(arg.addr);
        var t0 = Number(arg.t0), t1 = Number(arg.t1);
        if (!(t1 > t0)) { return EZ__fail("Invalid time range: " + t0 + " .. " + t1); }
        var eps = 1.0 / 240.0;

        var snapRange = EZ__snapshotRange(param, t0, t1, eps);
        var snapshot = {
            snapshotId: arg.snapshotId,
            addr: arg.addr,
            t0: t0, t1: t1,
            times: snapRange.times,
            values: snapRange.values,
            when: (new Date()).toString()
        };
        $.global.EZ_SNAPSHOTS[arg.snapshotId] = snapshot;

        var started = new Date().getTime();
        app.beginUndoGroup("Motion Ease apply");
        var mode = "bake", written = 0;
        try {
            EZ__removeInside(param, t0, t1, eps);
            // restore endpoints if the range-clear ate them (shouldn't, but cheap)
            if (!EZ__keyIndexAt(param, t0, eps)) { param.setValueAtTime(t0, snapRange.values[0]); }
            if (!EZ__keyIndexAt(param, t1, eps)) {
                param.setValueAtTime(t1, snapRange.values[snapRange.values.length - 1]);
            }
            if (arg.anchorCount === 2 && arg.vel) {
                try {
                    EZ__applyTrueEase(param, t0, t1, arg.vel, eps);
                    mode = "ease";
                } catch (eEase) {
                    written = EZ__applyBake(param, arg, t0, t1, eps);
                }
            } else {
                written = EZ__applyBake(param, arg, t0, t1, eps);
            }
        } finally {
            app.endUndoGroup();
        }

        return EZJ.stringify({
            ok: true,
            snapshot: snapshot,
            mode: mode,
            keysWritten: written,
            keyCountNow: param.numKeys,
            ms: new Date().getTime() - started
        });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}

// ---- revert ---------------------------------------------------------------------

function EZ_revert(argJson) {
    try {
        var arg = EZJ.parse(argJson);
        var snap = arg.snapshot;
        if (!snap && arg.snapshotId && $.global.EZ_SNAPSHOTS[arg.snapshotId]) {
            snap = $.global.EZ_SNAPSHOTS[arg.snapshotId];
        }
        if (!snap) { return EZ__fail("No snapshot to revert from (was Apply run this session?)"); }

        var param = EZ__resolveParam(arg.addr);
        var t0 = Number(snap.t0), t1 = Number(snap.t1);
        var eps = 1.0 / 240.0;

        app.beginUndoGroup("Motion Ease revert");
        try {
            // clear the whole range (inclusive), then restore snapshot keys
            for (var i = param.numKeys; i >= 1; i--) {
                var kt = param.keyTime(i);
                if (kt >= t0 - eps && kt <= t1 + eps) { param.removeKey(i); }
            }
            for (var r = 0; r < snap.times.length; r++) {
                param.setValueAtTime(snap.times[r], snap.values[r]);
            }
            // restored keys come back linear (original ease is not snapshotted —
            // same limitation as the Premiere engine)
            for (var j = 1; j <= param.numKeys; j++) {
                var jt = param.keyTime(j);
                if (jt >= t0 - eps && jt <= t1 + eps) {
                    try {
                        param.setInterpolationTypeAtKey(j,
                            KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                    } catch (eL) {}
                }
            }
        } finally {
            app.endUndoGroup();
        }
        return EZJ.stringify({ ok: true, restored: snap.times.length, keyCountNow: param.numKeys });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}
