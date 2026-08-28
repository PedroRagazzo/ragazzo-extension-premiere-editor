// Easify keyframe engine. ES3 ExtendScript.
//
// Contract with the panel:
//  - Every public EZ_* function takes ONE JSON-string argument and returns a
//    JSON string: {ok:true, ...} or {ok:false, error:"readable message"}.
//  - Params are addressed by INDEX ({trackIndex, clipIndex, componentIndex,
//    paramIndex}) plus clipName/paramName for drift validation — display
//    names are unreliable (third-party effects shadow built-in names, and
//    duplicate param names exist). Verified empirically in Phase 0.
//  - Times are plain seconds (Numbers). getKeys() Time objects are unwrapped
//    to .seconds before returning.
//  - The panel does ALL curve sampling; the engine just writes {t,v} pairs
//    with linear interpolation. ExtendScript stays dumb.
//
// Loaded via "$.evalFile in the same evalScript call" (see PHASE0-RESULTS.md:
// evalFile definitions do not persist across evalScript calls in PPro 2026).

var EZ_ENGINE_VERSION = "1.0.0";
var EZ_TICKS_PER_SECOND = 254016000000;

// Session snapshot registry (survives across calls because $.global does).
if (typeof $.global.EZ_SNAPSHOTS === "undefined") { $.global.EZ_SNAPSHOTS = {}; }

function EZ__err(e) {
    var m = "";
    try { m = (e && e.message) ? e.message : String(e); } catch (x) { m = "unstringifiable error"; }
    if (e && e.line) { m += " (jsx line " + e.line + ")"; }
    return m;
}

function EZ__fail(msg) { return JSON.stringify({ ok: false, error: msg }); }

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

function EZ__keyTimes(param) {
    var keys = param.getKeys();
    var out = [];
    if (!keys) { return out; }
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        out.push((k && typeof k.seconds === "number") ? k.seconds : Number(k));
    }
    return out;
}

function EZ__activeSeq() {
    if (!app.project) { throw new Error("No project open"); }
    var seq = app.project.activeSequence;
    if (!seq) { throw new Error("No active sequence — open a sequence in the Timeline"); }
    return seq;
}

// Resolve the sequence an address refers to. Normally the active sequence;
// an address may pin {projectName, seqName} to target a specific open
// project without it being frontmost (used by tests; also protects against
// the user switching projects between panel refresh and Apply).
function EZ__resolveSeq(addr) {
    if (addr && addr.projectName) {
        var proj = null;
        for (var i = 0; i < app.projects.numProjects; i++) {
            if (app.projects[i].name.indexOf(addr.projectName) !== -1) { proj = app.projects[i]; break; }
        }
        if (!proj) { throw new Error("Project '" + addr.projectName + "' is not open"); }
        if (addr.seqName) {
            for (var s = 0; s < proj.sequences.numSequences; s++) {
                if (proj.sequences[s].name === addr.seqName) { return proj.sequences[s]; }
            }
            throw new Error("Sequence '" + addr.seqName + "' not found in " + proj.name);
        }
        return proj.activeSequence;
    }
    return EZ__activeSeq();
}

// Resolve a clip from an address; validates the clip name still matches so a
// changed selection/edit doesn't silently retarget keyframes.
function EZ__resolveClip(addr) {
    var seq = EZ__resolveSeq(addr);
    var tracks = (addr.trackType === "audio") ? seq.audioTracks : seq.videoTracks;
    if (addr.trackIndex < 0 || addr.trackIndex >= tracks.numTracks) {
        throw new Error("Track " + addr.trackIndex + " no longer exists");
    }
    var track = tracks[addr.trackIndex];
    if (addr.clipIndex < 0 || addr.clipIndex >= track.clips.numItems) {
        throw new Error("Clip " + addr.clipIndex + " no longer exists on track " + addr.trackIndex);
    }
    var clip = track.clips[addr.clipIndex];
    if (addr.clipName && clip.name !== addr.clipName) {
        throw new Error("Clip at that position is now '" + clip.name + "', expected '" +
                        addr.clipName + "' — reselect the clip and refresh");
    }
    return clip;
}

function EZ__resolveParam(addr) {
    var clip = EZ__resolveClip(addr);
    if (addr.componentIndex < 0 || addr.componentIndex >= clip.components.numItems) {
        throw new Error("Component " + addr.componentIndex + " no longer exists (effect removed?)");
    }
    var comp = clip.components[addr.componentIndex];
    if (addr.paramIndex < 0 || addr.paramIndex >= comp.properties.numItems) {
        throw new Error("Param " + addr.paramIndex + " no longer exists");
    }
    var param = comp.properties[addr.paramIndex];
    if (addr.paramName && param.displayName !== addr.paramName) {
        throw new Error("Param at that position is now '" + param.displayName +
                        "', expected '" + addr.paramName + "' — refresh the property list");
    }
    return param;
}

function EZ_ping() {
    return JSON.stringify({ ok: true, engine: EZ_ENGINE_VERSION, app: app.version });
}

// Cheap poll target: identifies the current video-clip selection AND its
// total keyframe count, so the panel refreshes both when the user selects a
// different clip and when they add/remove keyframes in Effect Controls.
function EZ_getSelectionSignature() {
    try {
        var seq = EZ__activeSeq();
        var sig = (typeof seq.sequenceID !== "undefined" ? String(seq.sequenceID) : seq.name);
        var found = "";
        var keySum = 0;
        var sel = seq.getSelection();
        for (var s = 0; s < sel.length; s++) {
            var it = sel[s];
            if (it && it.mediaType === "Video") {
                found = it.name + "@" + it.start.seconds + "-" + it.end.seconds;
                // find the actual track item to count keys on (same match
                // logic as EZ_getSelection)
                for (var t = 0; t < seq.videoTracks.numTracks && keySum === 0; t++) {
                    var track = seq.videoTracks[t];
                    for (var c = 0; c < track.clips.numItems; c++) {
                        var cand = track.clips[c];
                        if (cand.start.seconds === it.start.seconds &&
                            cand.end.seconds === it.end.seconds && cand.name === it.name) {
                            for (var ci = 0; ci < cand.components.numItems; ci++) {
                                var comp = cand.components[ci];
                                for (var pi = 0; pi < comp.properties.numItems; pi++) {
                                    try {
                                        var p = comp.properties[pi];
                                        if (p.areKeyframesSupported() && p.isTimeVarying()) {
                                            var ks = p.getKeys();
                                            keySum += ks ? ks.length : 0;
                                        }
                                    } catch (eP) {}
                                }
                            }
                            break;
                        }
                    }
                }
                break;
            }
        }
        return JSON.stringify({ ok: true, sig: sig + "|" + found + "|k" + keySum });
    } catch (e) {
        return JSON.stringify({ ok: true, sig: "no-seq" });
    }
}

// ---- selection + property tree ------------------------------------------------

function EZ_getSelection() {
    try {
        var seq = EZ__activeSeq();
        var fps = EZ_TICKS_PER_SECOND / Number(seq.timebase);
        var sel = seq.getSelection();
        var clip = null, trackIndex = -1, clipIndex = -1;

        // find the first selected VIDEO clip and its track/clip indices
        for (var s = 0; s < sel.length && !clip; s++) {
            var item = sel[s];
            if (!item || item.mediaType !== "Video") { continue; }
            for (var t = 0; t < seq.videoTracks.numTracks && !clip; t++) {
                var track = seq.videoTracks[t];
                for (var c = 0; c < track.clips.numItems; c++) {
                    var cand = track.clips[c];
                    if (cand.start.seconds === item.start.seconds &&
                        cand.end.seconds === item.end.seconds &&
                        cand.name === item.name) {
                        clip = cand; trackIndex = t; clipIndex = c;
                        break;
                    }
                }
            }
        }
        if (!clip) {
            return EZ__fail("Select a video clip in the active sequence, then hit refresh");
        }

        var components = [];
        for (var ci = 0; ci < clip.components.numItems; ci++) {
            var comp = clip.components[ci];
            var params = [];
            for (var pi = 0; pi < comp.properties.numItems; pi++) {
                var p = comp.properties[pi];
                var supported = false, numKeys = 0, timeVarying = false;
                try { supported = p.areKeyframesSupported(); } catch (e1) {}
                if (supported) {
                    try {
                        timeVarying = p.isTimeVarying();
                        if (timeVarying) { numKeys = EZ__keyTimes(p).length; }
                    } catch (e2) {}
                }
                var val = null, dims = 1;
                try {
                    val = p.getValue();
                    if (val instanceof Array) { dims = val.length; }
                } catch (e3) {}
                params.push({
                    paramIndex: pi,
                    displayName: p.displayName,
                    kfSupported: supported,
                    timeVarying: timeVarying,
                    numKeys: numKeys,
                    dims: dims,
                    value: EZ__safeVal(val)
                });
            }
            components.push({
                componentIndex: ci,
                displayName: comp.displayName,
                matchName: comp.matchName,
                params: params
            });
        }

        return JSON.stringify({
            ok: true,
            clip: {
                name: clip.name,
                trackType: "video",
                trackIndex: trackIndex,
                clipIndex: clipIndex,
                start: clip.start.seconds,
                end: clip.end.seconds,
                fps: fps
            },
            sequence: { name: seq.name, fps: fps },
            components: components
        });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}

// ---- keyframe reads ------------------------------------------------------------

// EP-PORT (host-001): o Premiere deste projeto exige OBJETO Time nos setters de keyframe — passar Number cru vira
// NO-OP silencioso (bug "zoom fantasma", ver host/bridge.jsx _EP_plainKey / voiceLevel.jsx). Todo tempo passado a
// addKey/setValueAtKey/setInterpolationTypeAtKey/removeKeyRange/getValueAtKey vai por aqui.
function EZ__T(sec) { var t = new Time(); var n = Number(sec); if (isNaN(n)) { n = 0; } t.seconds = n; return t; }

function EZ_getKeys(argJson) {
    try {
        var addr = JSON.parse(argJson);
        var param = EZ__resolveParam(addr);
        if (!param.areKeyframesSupported()) { return EZ__fail("Keyframes not supported on this param"); }
        if (!param.isTimeVarying()) {
            return JSON.stringify({ ok: true, timeVarying: false, times: [], values: [] });
        }
        var times = EZ__keyTimes(param);
        var values = [];
        for (var i = 0; i < times.length; i++) {
            values.push(EZ__safeVal(param.getValueAtKey(EZ__T(times[i]))));
        }
        return JSON.stringify({ ok: true, timeVarying: true, times: times, values: values });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}

// ---- apply (bake) ---------------------------------------------------------------
// arg: { addr, snapshotId, t0, t1, samples: [{t, v}], setEndpointInterp: bool }
// v is a number or an array matching the param's dimensions.
// Steps: snapshot existing keys in [t0,t1] -> clear strictly-inside keys ->
// write samples with linear interp -> report.

function EZ_apply(argJson) {
    try {
        var arg = JSON.parse(argJson);
        var param = EZ__resolveParam(arg.addr);
        if (!param.areKeyframesSupported()) { return EZ__fail("Keyframes not supported on this param"); }

        var t0 = Number(arg.t0), t1 = Number(arg.t1);
        if (!(t1 > t0)) { return EZ__fail("Invalid time range: " + t0 + " .. " + t1); }
        var eps = 1.0 / 240.0;

        param.setTimeVarying(true);

        // -- snapshot everything in [t0, t1] (inclusive) for revert
        var snapTimes = [], snapValues = [];
        var existing = EZ__keyTimes(param);
        for (var i = 0; i < existing.length; i++) {
            if (existing[i] >= t0 - eps && existing[i] <= t1 + eps) {
                snapTimes.push(existing[i]);
                snapValues.push(EZ__safeVal(param.getValueAtKey(EZ__T(existing[i]))));
            }
        }
        var snapshot = {
            snapshotId: arg.snapshotId,
            addr: arg.addr,
            t0: t0, t1: t1,
            times: snapTimes,
            values: snapValues,
            when: (new Date()).toString()
        };
        $.global.EZ_SNAPSHOTS[arg.snapshotId] = snapshot;

        var started = new Date().getTime();

        // -- clear strictly-inside keys (previous bakes included)
        if (existing.length) {
            param.removeKeyRange(EZ__T(t0 + eps), EZ__T(t1 - eps), 0);
        }

        // -- endpoints: the user's own keys at t0/t1 survive removeKeyRange
        // untouched. NEVER call addKey on an existing key time — in PPro 2026
        // that RESETS the key's value to 0 (verified empirically). Only if an
        // endpoint key is somehow missing, recreate it from the snapshot.
        var nowTimes = EZ__keyTimes(param);
        var haveT0 = false, haveT1 = false;
        for (var q = 0; q < nowTimes.length; q++) {
            if (Math.abs(nowTimes[q] - t0) <= eps) { haveT0 = true; }
            if (Math.abs(nowTimes[q] - t1) <= eps) { haveT1 = true; }
        }
        var restoreEndpoint = function (t) {
            var tt = EZ__T(t);
            param.addKey(tt);
            for (var r = 0; r < snapTimes.length; r++) {
                if (Math.abs(snapTimes[r] - t) <= eps) {
                    param.setValueAtKey(tt, snapValues[r], true);
                    return;
                }
            }
        };
        if (!haveT0) { restoreEndpoint(t0); }
        if (!haveT1) { restoreEndpoint(t1); }

        // -- write baked samples
        var n = arg.samples.length;
        for (var k = 0; k < n; k++) {
            var s = arg.samples[k];
            var t = Number(s.t);
            if (t <= t0 + eps || t >= t1 - eps) { continue; } // safety: never touch outside/edges
            var tt = EZ__T(t);
            param.addKey(tt);
            param.setValueAtKey(tt, s.v, true);
            try { param.setInterpolationTypeAtKey(tt, 0, true); } catch (eIt) {} // linear
        }
        if (arg.setEndpointInterp) {
            try {
                param.setInterpolationTypeAtKey(EZ__T(t0), 0, true);
                param.setInterpolationTypeAtKey(EZ__T(t1), 0, true);
            } catch (eI) {}
        }

        var after = EZ__keyTimes(param).length;
        return JSON.stringify({
            ok: true,
            snapshot: snapshot,
            keysWritten: n,
            keyCountNow: after,
            ms: new Date().getTime() - started
        });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}

// ---- revert ---------------------------------------------------------------------
// arg: { addr, snapshot: {t0, t1, times, values} } OR { addr, snapshotId }
// (client passes the full snapshot back; host registry is the fallback).

function EZ_revert(argJson) {
    try {
        var arg = JSON.parse(argJson);
        var snap = arg.snapshot;
        if (!snap && arg.snapshotId && $.global.EZ_SNAPSHOTS[arg.snapshotId]) {
            snap = $.global.EZ_SNAPSHOTS[arg.snapshotId];
        }
        if (!snap) { return EZ__fail("No snapshot to revert from (was Apply run this session?)"); }

        var param = EZ__resolveParam(arg.addr);
        var t0 = Number(snap.t0), t1 = Number(snap.t1);
        var eps = 1.0 / 240.0;

        // wipe the whole range, then restore snapshot keys exactly
        param.removeKeyRange(EZ__T(t0 - eps), EZ__T(t1 + eps), 0);
        for (var i = 0; i < snap.times.length; i++) {
            var t = Number(snap.times[i]);
            var tt = EZ__T(t);
            param.addKey(tt);
            param.setValueAtKey(tt, snap.values[i], true);
        }
        // if the param had no keys at all inside the range before, and none
        // outside either, it may be back to a keyless time-varying state;
        // leave timeVarying as-is (harmless, and safer than clearing values).

        var times = EZ__keyTimes(param);
        return JSON.stringify({ ok: true, keyCountNow: times.length, restored: snap.times.length });
    } catch (e) { return EZ__fail(EZ__err(e)); }
}
