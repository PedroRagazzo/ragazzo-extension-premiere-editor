/* Easify curve math — the single source of truth for bezier evaluation,
 * speed (derivative) transforms, and time-monotonic sampling.
 *
 * ES5, dual-export: usable from Node (tests) and the CEP client.
 *
 * Model v2 — piecewise cubic bezier ("multi-anchor")
 * --------------------------------------------------
 * A curve is a list of ANCHORS. Endpoints are fixed at (0,0) and (1,1) and
 * map to the user's two endpoint keyframes. Any number of mid anchors may
 * sit strictly between them (0 < x < 1, strictly increasing). Each anchor
 * has independent in/out handles stored as RELATIVE offsets {dx, dy}:
 *
 *   { anchors: [
 *       { x: 0, y: 0, out: {dx, dy} },
 *       { x, y, in: {dx, dy}, out: {dx, dy} },   // 0..n mid anchors
 *       { x: 1, y: 1, in: {dx, dy} }
 *   ] }
 *
 * Invariants enforced by sanitize()/norm():
 *   - x strictly increasing; mid-anchor x kept inside (0,1)
 *   - out.dx >= 0, in.dx <= 0, and each handle's |dx| <= its segment width,
 *     so x(t) is monotone per segment -> time never runs backward
 *   - y and handle dy are FREE (overshoot/anticipate/bounce are legal)
 *   - handles are independent (corners allowed — that's how bounces work)
 *
 * v1 compat: { x1, y1, x2, y2 } (CSS cubic-bezier semantics) and flat
 * points [x1,y1,x2,y2] convert losslessly via norm()/fromPoints().
 *
 * Preset schema v2: { name, version: 2, curveType: "bezier",
 *                     anchors: [...], createdAt }
 * (v1 presets: version: 1, points: [x1,y1,x2,y2] — still importable.)
 */
(function (root, factory) {
    // In CEP panels with --enable-nodejs, `module` exists in the page context
    // too — export BOTH ways, or the browser global silently vanishes.
    var api = factory();
    if (typeof module === "object" && module.exports) { module.exports = api; }
    if (root) { root.EFCurves = api; }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    var EPS = 1e-7;
    var MIN_SEG = 1e-4;       // minimum anchor x spacing
    var MIN_INFLUENCE = 0.1;  // AE clamps influence to [0.1%, 100%]

    function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
    function num(v, fallback) {
        v = Number(v);
        return isFinite(v) ? v : (fallback || 0);
    }

    // ---- general cubic bezier (4 arbitrary scalar control values) ----------
    function bez4(t, p0, p1, p2, p3) {
        var mt = 1 - t;
        return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
    }
    function bez4d(t, p0, p1, p2, p3) {
        var mt = 1 - t;
        return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
    }

    // ---- normalization ------------------------------------------------------
    function isV1(c) {
        return c && typeof c.x1 !== "undefined" && !c.anchors;
    }

    function v1ToAnchors(c) {
        var x1 = clamp(num(c.x1), 0, 1), y1 = num(c.y1);
        var x2 = clamp(num(c.x2), 0, 1), y2 = num(c.y2);
        return [
            { x: 0, y: 0, out: { dx: x1, dy: y1 } },
            { x: 1, y: 1, in: { dx: x2 - 1, dy: y2 - 1 } }
        ];
    }

    // Deep-copy + enforce all invariants. Accepts v1 {x1..}, {points:[4]},
    // {anchors:[...]}, or a bare anchors array.
    function norm(curve) {
        var anchors;
        if (!curve) { anchors = v1ToAnchors({ x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 }); }
        else if (curve instanceof Array) { anchors = curve; }
        else if (curve.anchors) { anchors = curve.anchors; }
        else if (curve.points && curve.points.length === 4) {
            anchors = v1ToAnchors({ x1: curve.points[0], y1: curve.points[1], x2: curve.points[2], y2: curve.points[3] });
        }
        else if (isV1(curve)) { anchors = v1ToAnchors(curve); }
        else { anchors = v1ToAnchors({ x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 }); }

        // copy + coerce mids, keep only in-range, sort by x
        var mids = [];
        for (var i = 0; i < anchors.length; i++) {
            var a = anchors[i];
            if (!a) { continue; }
            if (i === 0 || i === anchors.length - 1) { continue; }
            var x = num(a.x, -1);
            if (x <= MIN_SEG || x >= 1 - MIN_SEG) { continue; }
            mids.push({
                x: x,
                y: num(a.y),
                in: { dx: num(a.in && a.in.dx), dy: num(a.in && a.in.dy) },
                out: { dx: num(a.out && a.out.dx), dy: num(a.out && a.out.dy) }
            });
        }
        mids.sort(function (p, q) { return p.x - q.x; });
        // enforce strict spacing
        for (var m = 0; m < mids.length; m++) {
            var loX = (m === 0) ? MIN_SEG : mids[m - 1].x + MIN_SEG;
            if (mids[m].x < loX) { mids[m].x = loX; }
            if (mids[m].x > 1 - MIN_SEG) { mids[m].x = 1 - MIN_SEG; }
        }

        var first = anchors[0] || {};
        var last = anchors[anchors.length - 1] || {};
        var out = [{ x: 0, y: 0, out: { dx: num(first.out && first.out.dx, 1 / 3), dy: num(first.out && first.out.dy, 1 / 3) } }];
        for (var k = 0; k < mids.length; k++) { out.push(mids[k]); }
        out.push({ x: 1, y: 1, in: { dx: num(last.in && last.in.dx, -1 / 3), dy: num(last.in && last.in.dy, -1 / 3) } });

        // clamp handle dx into segment widths (monotone time)
        for (var s = 0; s < out.length - 1; s++) {
            var A = out[s], B = out[s + 1];
            var w = B.x - A.x;
            A.out.dx = clamp(A.out.dx, 0, w);
            B.in.dx = clamp(B.in.dx, -w, 0);
        }
        return { anchors: out };
    }

    // Back-compat alias: sanitize(v1curve) historically returned {x1,y1,x2,y2};
    // it now returns the canonical anchors form. All internal callers updated.
    function sanitize(curve) { return norm(curve); }

    function segCount(curve) { return curve.anchors.length - 1; }

    // control points of segment s as absolute coords
    function segPts(curve, s) {
        var A = curve.anchors[s], B = curve.anchors[s + 1];
        return {
            x0: A.x, y0: A.y,
            x1: A.x + A.out.dx, y1: A.y + A.out.dy,
            x2: B.x + B.in.dx, y2: B.y + B.in.dy,
            x3: B.x, y3: B.y
        };
    }

    function segForX(curve, x) {
        var a = curve.anchors;
        for (var s = 0; s < a.length - 2; s++) {
            if (x < a[s + 1].x) { return s; }
        }
        return a.length - 2;
    }

    // solve bezier parameter t for absolute time x within segment points p
    // (x(t) monotone because dx handles are clamped into the segment)
    function solveSegT(p, x) {
        if (x <= p.x0) { return 0; }
        if (x >= p.x3) { return 1; }
        var t = (x - p.x0) / (p.x3 - p.x0);
        for (var i = 0; i < 8; i++) {
            var err = bez4(t, p.x0, p.x1, p.x2, p.x3) - x;
            if (Math.abs(err) < EPS) { return t; }
            var d = bez4d(t, p.x0, p.x1, p.x2, p.x3);
            if (Math.abs(d) < 1e-7) { break; }
            t = t - err / d;
            if (t <= 0 || t >= 1) { break; }
        }
        var lo = 0, hi = 1;
        t = (x - p.x0) / (p.x3 - p.x0);
        while (hi - lo > EPS) {
            if (bez4(t, p.x0, p.x1, p.x2, p.x3) < x) { lo = t; } else { hi = t; }
            t = (lo + hi) / 2;
        }
        return t;
    }

    function ensure(curve) {
        return (curve && curve.anchors) ? curve : norm(curve);
    }

    // ---- public: value / speed at normalized time x --------------------------
    function valueAt(curve, x) {
        curve = ensure(curve);
        if (x <= 0) { return 0; }
        if (x >= 1) { return 1; }
        var s = segForX(curve, x);
        var p = segPts(curve, s);
        var t = solveSegT(p, x);
        return bez4(t, p.y0, p.y1, p.y2, p.y3);
    }

    // dy/dx; at corner anchors this is the one-sided derivative of the
    // segment x falls in. Capped so vertical tangents stay finite for the UI.
    function speedAt(curve, x) {
        curve = ensure(curve);
        x = clamp(x, 0.0000001, 0.9999999);
        var s = segForX(curve, x);
        var p = segPts(curve, s);
        var t = solveSegT(p, x);
        var dx = bez4d(t, p.x0, p.x1, p.x2, p.x3);
        var dy = bez4d(t, p.y0, p.y1, p.y2, p.y3);
        if (Math.abs(dx) < 1e-6) { return dy >= 0 ? 1e6 : -1e6; }
        return dy / dx;
    }

    // ---- public: sampling ------------------------------------------------------
    // n {time,value} pairs strictly increasing in time, endpoints EXCLUDED
    // (those are the user's own keyframes).
    function sample(curve, n) {
        curve = ensure(curve);
        var out = [];
        for (var i = 1; i <= n; i++) {
            var x = i / (n + 1);
            out.push({ time: x, value: valueAt(curve, x) });
        }
        return out;
    }

    // ---- anchor editing ----------------------------------------------------------
    // Insert an anchor at time x WITHOUT changing the curve's shape
    // (de Casteljau split of the containing segment). Returns new curve +
    // index of the inserted anchor.
    function addAnchor(curve, x) {
        curve = norm(curve);
        x = clamp(x, MIN_SEG * 2, 1 - MIN_SEG * 2);
        var s = segForX(curve, x);
        var A = curve.anchors[s], B = curve.anchors[s + 1];
        if (x - A.x < MIN_SEG * 2 || B.x - x < MIN_SEG * 2) {
            return { curve: curve, index: -1 }; // too close to an existing anchor
        }
        var p = segPts(curve, s);
        var t = solveSegT(p, x);

        function lerp(a, b) { return a + (b - a) * t; }
        var q0x = lerp(p.x0, p.x1), q0y = lerp(p.y0, p.y1);
        var q1x = lerp(p.x1, p.x2), q1y = lerp(p.y1, p.y2);
        var q2x = lerp(p.x2, p.x3), q2y = lerp(p.y2, p.y3);
        var r0x = lerp(q0x, q1x), r0y = lerp(q0y, q1y);
        var r1x = lerp(q1x, q2x), r1y = lerp(q1y, q2y);
        var sx = lerp(r0x, r1x), sy = lerp(r0y, r1y);

        var mid = {
            x: sx, y: sy,
            in: { dx: r0x - sx, dy: r0y - sy },
            out: { dx: r1x - sx, dy: r1y - sy }
        };
        A.out = { dx: q0x - p.x0, dy: q0y - p.y0 };
        B.in = { dx: q2x - p.x3, dy: q2y - p.y3 };
        curve.anchors.splice(s + 1, 0, mid);
        return { curve: norm(curve), index: s + 1 };
    }

    // Remove a mid anchor (endpoints protected). Neighboring handles are kept,
    // so the joined segment approximates the old pair.
    function removeAnchor(curve, index) {
        curve = norm(curve);
        if (index <= 0 || index >= curve.anchors.length - 1) { return curve; }
        curve.anchors.splice(index, 1);
        return norm(curve);
    }

    // ---- AE-style keyframe velocity semantics (endpoint handles) ---------------
    // Influence % is the handle's reach along time relative to the FULL span.
    function toVelocity(curve) {
        curve = ensure(curve);
        var first = curve.anchors[0], last = curve.anchors[curve.anchors.length - 1];
        var odx = first.out.dx, idx = -last.in.dx; // both >= 0
        return {
            outgoing: {
                speed: odx < EPS ? 0 : first.out.dy / odx,
                influence: clamp(odx * 100, MIN_INFLUENCE, 100)
            },
            incoming: {
                speed: idx < EPS ? 0 : (-last.in.dy) / idx,
                influence: clamp(idx * 100, MIN_INFLUENCE, 100)
            }
        };
    }

    // Applies endpoint velocities to a curve, preserving mid anchors.
    function fromVelocity(v, base) {
        var curve = norm(base || undefined);
        var odx = clamp(num(v.outgoing.influence) / 100, MIN_INFLUENCE / 100, 1);
        var idx = clamp(num(v.incoming.influence) / 100, MIN_INFLUENCE / 100, 1);
        var first = curve.anchors[0], last = curve.anchors[curve.anchors.length - 1];
        first.out = { dx: odx, dy: num(v.outgoing.speed) * odx };
        last.in = { dx: -idx, dy: -num(v.incoming.speed) * idx };
        return norm(curve);
    }

    // ---- (de)serialization ---------------------------------------------------------
    // v1 flat points — only meaningful for 2-anchor curves; null otherwise.
    function toPoints(curve) {
        curve = ensure(curve);
        if (curve.anchors.length !== 2) { return null; }
        var f = curve.anchors[0], l = curve.anchors[1];
        return [f.out.dx, f.out.dy, 1 + l.in.dx, 1 + l.in.dy];
    }
    function fromPoints(pts) {
        return norm({ x1: pts[0], y1: pts[1], x2: pts[2], y2: pts[3] });
    }

    function cloneAnchors(curve) {
        curve = ensure(curve);
        return norm(curve).anchors;
    }

    // canonical rounded string — for equality checks / preset highlighting
    function canon(curve) {
        curve = ensure(curve);
        var parts = [];
        for (var i = 0; i < curve.anchors.length; i++) {
            var a = curve.anchors[i];
            parts.push([
                a.x.toFixed(5), a.y.toFixed(5),
                a.in ? a.in.dx.toFixed(5) : "",
                a.in ? a.in.dy.toFixed(5) : "",
                a.out ? a.out.dx.toFixed(5) : "",
                a.out ? a.out.dy.toFixed(5) : ""
            ].join(","));
        }
        return parts.join(";");
    }

    return {
        norm: norm,
        sanitize: sanitize,
        valueAt: valueAt,
        speedAt: speedAt,
        sample: sample,
        addAnchor: addAnchor,
        removeAnchor: removeAnchor,
        toVelocity: toVelocity,
        fromVelocity: fromVelocity,
        toPoints: toPoints,
        fromPoints: fromPoints,
        cloneAnchors: cloneAnchors,
        canon: canon,
        _bez4: bez4,
        _bez4d: bez4d,
        _segPts: segPts,
        _solveSegT: solveSegT
    };
}));
