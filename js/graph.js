/* Motion Ease graph editor — pure canvas component, no host/app dependencies.
 *
 * One underlying model: a multi-anchor piecewise bezier (EFCurves v2).
 * Two render/interaction modes over that single model:
 *   value — y(x): drag anchors and their handles; double-click the curve to
 *           add an anchor (shape-preserving split), double-click a mid
 *           anchor to remove it
 *   speed — dy/dx: endpoint speed/influence handles are editable (dx =
 *           influence, dy = speed); mid anchors are shown read-only —
 *           structural edits happen in value mode
 *
 * Snapping: drags snap to landmarks (value: y = 0/1, anchor x = quarters;
 * speed: whole/half speeds, 5% influence steps). Hold Shift to bypass.
 * A guide line flashes while a snap is engaged.
 *
 * Drag stability: the value<->pixel mapping is FROZEN for the duration of a
 * drag (this._dragRange). Recomputing it per frame creates a positive
 * feedback loop — the range grows, the same cursor pixel maps to a bigger
 * value, the range grows again — which is how "small" overshoots used to
 * run away to 10x.
 */
(function (root) {
    "use strict";
    var C = root.EFCurves;

    // Paleta lida das CSS custom properties do painel (não hardcoded), para o
    // canvas acompanhar a troca de tema (escuro/papel) sem precisar duplicar
    // o editor inteiro. Recalculada a cada draw() — o canvas é pequeno e o
    // redesenho não é hot-path suficiente pra isso pesar.
    function _readColors() {
        var cs = getComputedStyle(document.documentElement);
        function v(name, fallback) {
            var val = cs.getPropertyValue(name);
            return val ? val.trim() : fallback;
        }
        return {
            bg: v("--bg", "#161615"),
            unit: v("--card-hover", "#232221"),
            grid: v("--border", "#37342f"),
            gridMinor: v("--border-soft", "#2a2826"),
            curve: v("--accent", "#ff7a26"),
            curveSpeed: v("--accent-2", "#ffa74d"),
            arm: v("--text-dim", "#7a736a"),
            handle: v("--accent-2", "#ffc78f"),
            handleRing: v("--panel", "#ffffff"),
            endpoint: v("--text", "#f3efe9"),
            anchor: "#ffd24a",
            anchorRing: v("--bg", "#161615"),
            preview: "#ffd24a",
            label: v("--text-dim", "#9d968c"),
            snap: v("--ok", "#57c08a")
        };
    }

    var SNAP_PX = 7;                      // engage distance in pixels
    var VALUE_Y_LANDMARKS = [0, 1];
    var VALUE_X_LANDMARKS = [0.25, 0.5, 0.75];
    var SPEED_LANDMARKS = [-2, -1, -0.5, 0, 0.5, 1, 2];
    var INFLUENCE_STEP = 0.05;            // 5% steps

    function EZGraph(canvas, opts) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        this.opts = opts || {};
        this.curve = C.norm({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 });
        this.mode = "value";
        this.pad = { l: 34, r: 14, t: 14, b: 20 };
        this.drag = null;          // {kind:"anchor"|"handle", i, side?}
        this._dragRange = null;    // frozen y-range while dragging
        this._snapGuides = null;   // {x?, y?} in graph units, for guide render
        this.activeAnchor = null;  // mid-anchor whose handles are shown
        this.previewPhase = 0;
        this.previewOn = true;
        this._bindEvents();
        this.resize();
    }

    EZGraph.prototype.setCurve = function (c) {
        this.curve = C.norm(c);
        if (this.activeAnchor !== null && this.activeAnchor >= this.curve.anchors.length - 1) {
            this.activeAnchor = null;
        }
        this.draw();
        this._emit();
    };
    EZGraph.prototype.getCurve = function () { return this.curve; };
    EZGraph.prototype.setMode = function (m) {
        this.mode = (m === "speed") ? "speed" : "value";
        this.drag = null;
        this._dragRange = null;
        this.draw();
    };
    EZGraph.prototype.setPreviewPhase = function (p) {
        this.previewPhase = p;
        this.draw();
    };

    EZGraph.prototype._emit = function () {
        if (this.opts.onChange) { this.opts.onChange(this.curve); }
    };

    EZGraph.prototype.resize = function () {
        var dpr = window.devicePixelRatio || 1;
        var rect = this.canvas.getBoundingClientRect();
        this.canvas.width = Math.max(50, Math.round(rect.width * dpr));
        this.canvas.height = Math.max(50, Math.round(rect.height * dpr));
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.w = rect.width;
        this.h = rect.height;
        this.draw();
    };

    // ---- ranges -------------------------------------------------------------
    EZGraph.prototype._valueRange = function () {
        if (this._dragRange && this.mode === "value") { return this._dragRange; }
        var c = this.curve, lo = 0, hi = 1;
        for (var a = 0; a < c.anchors.length; a++) {
            var an = c.anchors[a];
            if (an.y < lo) { lo = an.y; }
            if (an.y > hi) { hi = an.y; }
            if (an.out) { lo = Math.min(lo, an.y + an.out.dy); hi = Math.max(hi, an.y + an.out.dy); }
            if (an.in) { lo = Math.min(lo, an.y + an.in.dy); hi = Math.max(hi, an.y + an.in.dy); }
        }
        for (var i = 1; i < 16; i++) {
            var v = C.valueAt(c, i / 16);
            if (v < lo) { lo = v; }
            if (v > hi) { hi = v; }
        }
        var m = 0.12 * (hi - lo);
        return { lo: lo - m, hi: hi + m };
    };

    EZGraph.prototype._speedRange = function () {
        if (this._dragRange && this.mode === "speed") { return this._dragRange; }
        // baseline 0..1.5: no dead space below zero unless the curve (or a
        // velocity handle) actually goes negative — otherwise the curve
        // floats in the middle of the plot
        var c = this.curve, hi = 1.5, lo = 0;
        for (var i = 0; i <= 32; i++) {
            var s = C.speedAt(c, i / 32);
            if (s > hi && s < 50) { hi = s; }
            if (s < lo && s > -50) { lo = s; }
        }
        var vel = C.toVelocity(c);
        hi = Math.max(hi, vel.outgoing.speed, vel.incoming.speed);
        lo = Math.min(lo, vel.outgoing.speed, vel.incoming.speed);
        var m = 0.15 * (hi - lo);
        // full bottom margin only when the curve actually dips negative;
        // otherwise keep the 0-line pinned near the plot floor
        return { lo: lo < 0 ? lo - m : lo - 0.02 * (hi - lo), hi: hi + m };
    };

    // Clip subsequent drawing to the plot rectangle. While dragging, the
    // frozen range means the curve can legitimately exceed the plot — it must
    // paint off-plot (clipped) rather than clamp to fake plateaus.
    EZGraph.prototype._clipPlot = function () {
        var ctx = this.ctx;
        ctx.save();
        ctx.beginPath();
        ctx.rect(this.pad.l, this.pad.t, this.w - this.pad.l - this.pad.r,
                 this.h - this.pad.t - this.pad.b);
        ctx.clip();
    };

    EZGraph.prototype._range = function () {
        return this.mode === "value" ? this._valueRange() : this._speedRange();
    };

    // graph-space <-> pixel-space
    EZGraph.prototype._gx = function (x) {
        return this.pad.l + x * (this.w - this.pad.l - this.pad.r);
    };
    EZGraph.prototype._gy = function (y, range) {
        var f = (y - range.lo) / (range.hi - range.lo);
        return this.h - this.pad.b - f * (this.h - this.pad.t - this.pad.b);
    };
    EZGraph.prototype._ux = function (px) {
        return (px - this.pad.l) / (this.w - this.pad.l - this.pad.r);
    };
    EZGraph.prototype._uy = function (py, range) {
        var f = (this.h - this.pad.b - py) / (this.h - this.pad.t - this.pad.b);
        return range.lo + f * (range.hi - range.lo);
    };

    // ---- drawing -------------------------------------------------------------
    EZGraph.prototype.draw = function () {
        this._col = _readColors();
        var ctx = this.ctx;
        ctx.clearRect(0, 0, this.w, this.h);
        ctx.fillStyle = this._col.bg;
        ctx.fillRect(0, 0, this.w, this.h);
        if (this.mode === "value") { this._drawValue(); }
        else { this._drawSpeed(); }
        this._drawSnapGuides();
    };

    EZGraph.prototype._drawGridX = function () {
        var ctx = this.ctx;
        for (var i = 0; i <= 4; i++) {
            var x = this._gx(i / 4);
            ctx.strokeStyle = (i === 0 || i === 4) ? this._col.grid : this._col.gridMinor;
            ctx.beginPath();
            ctx.moveTo(x, this.pad.t);
            ctx.lineTo(x, this.h - this.pad.b);
            ctx.stroke();
        }
    };

    EZGraph.prototype._drawSnapGuides = function () {
        if (!this._snapGuides) { return; }
        var ctx = this.ctx, range = this._range();
        ctx.strokeStyle = this._col.snap;
        ctx.setLineDash([4, 3]);
        if (typeof this._snapGuides.y === "number") {
            var gy = this._gy(this._snapGuides.y, range);
            ctx.beginPath(); ctx.moveTo(this.pad.l, gy); ctx.lineTo(this.w - this.pad.r, gy); ctx.stroke();
        }
        if (typeof this._snapGuides.x === "number") {
            var gx = this._gx(this._snapGuides.x);
            ctx.beginPath(); ctx.moveTo(gx, this.pad.t); ctx.lineTo(gx, this.h - this.pad.b); ctx.stroke();
        }
        ctx.setLineDash([]);
    };

    EZGraph.prototype._drawValue = function () {
        var ctx = this.ctx, c = this.curve, range = this._valueRange();
        var self = this;

        // unit band 0..1
        var y0 = this._gy(0, range), y1 = this._gy(1, range);
        ctx.fillStyle = this._col.unit;
        ctx.fillRect(this.pad.l, y1, this.w - this.pad.l - this.pad.r, y0 - y1);

        this._drawGridX();
        [0, 0.5, 1].forEach(function (v) {
            var y = self._gy(v, range);
            ctx.strokeStyle = self._col.grid;
            ctx.beginPath(); ctx.moveTo(self.pad.l, y); ctx.lineTo(self.w - self.pad.r, y); ctx.stroke();
            ctx.fillStyle = self._col.label;
            ctx.font = "9px sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(String(v), self.pad.l - 4, y + 3);
        });

        // curve (clipped to the plot: with a frozen drag range it may exceed)
        this._clipPlot();
        ctx.strokeStyle = this._col.curve;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var i = 0; i <= 160; i++) {
            var x = i / 160, v = C.valueAt(c, x);
            var px = this._gx(x), py = this._gy(v, range);
            if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
        }
        ctx.stroke();
        ctx.restore();
        ctx.lineWidth = 1;

        // which anchors show handles: endpoints always + active mid anchor
        this._hit = { handles: [], anchors: [] };
        var last = c.anchors.length - 1;
        for (var ai = 0; ai <= last; ai++) {
            var a = c.anchors[ai];
            var apx = this._gx(a.x), apy = this._gy(a.y, range);
            var showHandles = (ai === 0 || ai === last || ai === this.activeAnchor);

            if (showHandles) {
                if (a.out) {
                    var ox = this._gx(a.x + a.out.dx), oy = this._gy(a.y + a.out.dy, range);
                    ctx.strokeStyle = this._col.arm;
                    ctx.beginPath(); ctx.moveTo(apx, apy); ctx.lineTo(ox, oy); ctx.stroke();
                    this._dot(ox, oy, 5.5, this._col.handle, true);
                    this._hit.handles.push({ i: ai, side: "out", px: ox, py: oy });
                }
                if (a.in) {
                    var ix = this._gx(a.x + a.in.dx), iy = this._gy(a.y + a.in.dy, range);
                    ctx.strokeStyle = this._col.arm;
                    ctx.beginPath(); ctx.moveTo(apx, apy); ctx.lineTo(ix, iy); ctx.stroke();
                    this._dot(ix, iy, 5.5, this._col.handle, true);
                    this._hit.handles.push({ i: ai, side: "in", px: ix, py: iy });
                }
            }

            if (ai === 0 || ai === last) {
                this._dot(apx, apy, 4, this._col.endpoint);
            } else {
                this._diamond(apx, apy, 5.5, ai === this.activeAnchor ? this._col.anchor : this._col.curve);
                this._hit.anchors.push({ i: ai, px: apx, py: apy });
            }
        }
        this._hitRange = range;

        // preview dot + motion bar
        if (this.previewOn) {
            var ph = this.previewPhase;
            if (ph >= 0 && ph <= 1) {
                var pv = C.valueAt(c, ph);
                this._dot(this._gx(ph), this._gy(pv, range), 4, this._col.preview);
                this._drawMotionBar(pv);
            }
        }
    };

    // The motion bar under the graph previews the eased position. Its track
    // is scaled so overshoot stays IN bounds: the resting position (value 1)
    // sits a bit before the right end — marked with a tick — and overshoot
    // travels into the remaining headroom. Anticipation gets the same
    // treatment on the left.
    EZGraph.prototype._drawMotionBar = function (pv) {
        var ctx = this.ctx, c = this.curve;
        var lo = 0, hi = 1;
        for (var i = 1; i < 24; i++) {
            var v = C.valueAt(c, i / 24);
            if (v < lo) { lo = v; }
            if (v > hi) { hi = v; }
        }
        // always keep some headroom so "1" rests before the end
        hi = Math.max(1.12, hi + 0.04);
        if (lo < 0) { lo -= 0.04; }
        var x0 = this.pad.l, x1 = this.w - this.pad.r;
        var map = function (v2) { return x0 + ((v2 - lo) / (hi - lo)) * (x1 - x0); };
        var y = this.h - this.pad.b + 6;

        // track + start/rest ticks
        ctx.fillStyle = this._col.gridMinor;
        ctx.fillRect(x0, y + 3, x1 - x0, 1);
        ctx.fillStyle = this._col.grid;
        ctx.fillRect(map(0) - 0.5, y + 1, 1, 6);
        ctx.fillRect(map(1) - 0.5, y, 1, 8);

        ctx.fillStyle = this._col.preview;
        ctx.fillRect(map(pv) - 1.5, y, 3, 8);
    };

    EZGraph.prototype._drawSpeed = function () {
        var ctx = this.ctx, c = this.curve, range = this._speedRange();
        var self = this;

        this._drawGridX();
        [0, 1].forEach(function (v) {
            var y = self._gy(v, range);
            ctx.strokeStyle = self._col.grid;
            ctx.beginPath(); ctx.moveTo(self.pad.l, y); ctx.lineTo(self.w - self.pad.r, y); ctx.stroke();
            ctx.fillStyle = self._col.label;
            ctx.font = "9px sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(v === 1 ? "1x" : "0", self.pad.l - 4, y + 3);
        });

        // speed curve, per segment so corner discontinuities don't paint fake
        // vertical walls; clipped (not clamped) so mid-drag out-of-range parts
        // paint truthfully instead of flattening into plateaus
        this._clipPlot();
        ctx.strokeStyle = this._col.curveSpeed;
        ctx.lineWidth = 2;
        for (var s = 0; s < c.anchors.length - 1; s++) {
            var xa = c.anchors[s].x, xb = c.anchors[s + 1].x;
            ctx.beginPath();
            for (var i = 0; i <= 60; i++) {
                var x = xa + (i / 60) * (xb - xa);
                var sv = C.speedAt(c, Math.min(Math.max(x, xa + 1e-5), xb - 1e-5));
                var px = this._gx(x), py = this._gy(sv, range);
                if (i === 0) { ctx.moveTo(px, py); } else { ctx.lineTo(px, py); }
            }
            ctx.stroke();
        }
        ctx.restore();
        ctx.lineWidth = 1;

        // mid anchors: read-only markers on the time axis
        this._hit = { handles: [], anchors: [] };
        for (var m = 1; m < c.anchors.length - 1; m++) {
            var mx = this._gx(c.anchors[m].x);
            ctx.strokeStyle = this._col.gridMinor;
            ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.moveTo(mx, this.pad.t); ctx.lineTo(mx, this.h - this.pad.b); ctx.stroke();
            ctx.setLineDash([]);
            this._diamond(mx, this.h - this.pad.b - 5, 4, this._col.gridMinor);
        }

        // endpoint speed/influence handles
        var vel = C.toVelocity(c);
        var clampY = (function (self) {
            return function (y) { return Math.max(self.pad.t, Math.min(self.h - self.pad.b, y)); };
        }(this));
        // endpoints anchor at the model's EXACT endpoint speeds (not near-edge
        // curve samples) so equal speeds sit at pixel-identical heights —
        // e.g. the default ease starts and ends on the same level
        var hOut = [this._gx(vel.outgoing.influence / 100), clampY(this._gy(vel.outgoing.speed, range))];
        var hIn = [this._gx(1 - vel.incoming.influence / 100), clampY(this._gy(vel.incoming.speed, range))];
        var e0 = [this._gx(0), clampY(this._gy(vel.outgoing.speed, range))];
        var e1 = [this._gx(1), clampY(this._gy(vel.incoming.speed, range))];

        ctx.strokeStyle = this._col.arm;
        ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(hOut[0], hOut[1]); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(e1[0], e1[1]); ctx.lineTo(hIn[0], hIn[1]); ctx.stroke();
        this._dot(e0[0], e0[1], 4, this._col.endpoint);
        this._dot(e1[0], e1[1], 4, this._col.endpoint);
        this._dot(hOut[0], hOut[1], 5.5, this._col.handle, true);
        this._dot(hIn[0], hIn[1], 5.5, this._col.handle, true);
        this._hit.handles.push({ i: 0, side: "out", px: hOut[0], py: hOut[1] });
        this._hit.handles.push({ i: c.anchors.length - 1, side: "in", px: hIn[0], py: hIn[1] });
        this._hitRange = range;

        if (this.previewOn) {
            var ph = this.previewPhase;
            if (ph >= 0 && ph <= 1) {
                var spv = Math.max(range.lo, Math.min(range.hi, C.speedAt(c, ph)));
                this._dot(this._gx(ph), this._gy(spv, range), 4, this._col.preview);
                this._drawMotionBar(C.valueAt(c, ph));
            }
        }
    };

    EZGraph.prototype._dot = function (x, y, r, color, ring) {
        var ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (ring) {
            ctx.strokeStyle = this._col.handleRing;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    };

    EZGraph.prototype._diamond = function (x, y, r, color) {
        var ctx = this.ctx;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r, y);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = this._col.anchorRing;
        ctx.stroke();
    };

    // ---- snapping helpers ---------------------------------------------------
    // Each returns {v, guide} — the (possibly) snapped value and the landmark
    // engaged, or guide undefined when free.
    EZGraph.prototype._snapToLandmarks = function (value, landmarks, unitPerPx, disabled) {
        if (disabled) { return { v: value }; }
        var bestD = SNAP_PX * unitPerPx, best;
        for (var i = 0; i < landmarks.length; i++) {
            var d = Math.abs(value - landmarks[i]);
            if (d < bestD) { bestD = d; best = landmarks[i]; }
        }
        return (best === undefined) ? { v: value } : { v: best, guide: best };
    };

    EZGraph.prototype._snapToStep = function (value, step, unitPerPx, disabled) {
        if (disabled) { return { v: value }; }
        var nearest = Math.round(value / step) * step;
        if (Math.abs(value - nearest) < SNAP_PX * unitPerPx) {
            return { v: nearest, guide: nearest };
        }
        return { v: value };
    };

    EZGraph.prototype._unitPerPxX = function () {
        return 1 / (this.w - this.pad.l - this.pad.r);
    };
    EZGraph.prototype._unitPerPxY = function (range) {
        return (range.hi - range.lo) / (this.h - this.pad.t - this.pad.b);
    };

    // ---- interaction -----------------------------------------------------------
    EZGraph.prototype._bindEvents = function () {
        var self = this;
        this.canvas.addEventListener("mousedown", function (e) {
            var pos = self._mouse(e);
            var hit = self._hitTest(pos);
            if (hit && hit.kind === "anchor") { self.activeAnchor = hit.i; }
            if (hit) {
                self.drag = hit;
                // freeze the pixel<->value mapping for the whole drag; the
                // live range would feed back on itself and run away
                self._dragRange = self._range();
                e.preventDefault();
            }
            self.draw();
        });
        window.addEventListener("mousemove", function (e) {
            if (!self.drag) { return; }
            self._dragTo(self._mouse(e), e.shiftKey);
        });
        // hover affordances: grab over draggables, copy (plus) over the
        // curve where a dbl-click would add an anchor
        this.canvas.addEventListener("mousemove", function (e) {
            if (self.drag) { self.canvas.style.cursor = "grabbing"; return; }
            var pos = self._mouse(e);
            var hit = self._hitTest(pos);
            if (hit) { self.canvas.style.cursor = "grab"; return; }
            if (self.mode === "value" && self._nearCurve(pos)) {
                self.canvas.style.cursor = "copy";
                return;
            }
            self.canvas.style.cursor = "default";
        });
        this.canvas.addEventListener("mouseleave", function () {
            if (!self.drag) { self.canvas.style.cursor = "default"; }
        });
        window.addEventListener("mouseup", function () {
            if (self.drag) {
                self.drag = null;
                self._dragRange = null;
                self._snapGuides = null;
                self.draw();
            }
        });
        this.canvas.addEventListener("dblclick", function (e) {
            if (self.mode !== "value") { return; }
            var pos = self._mouse(e);
            var hit = self._hitTest(pos);
            if (hit && hit.kind === "anchor") {
                // remove mid anchor
                self.activeAnchor = null;
                self.setCurve(C.removeAnchor(self.curve, hit.i));
                return;
            }
            // add an anchor on the curve at this time if the click is near it
            var ux = Math.max(0.01, Math.min(0.99, self._ux(pos.x)));
            var range = self._valueRange();
            var curveY = self._gy(C.valueAt(self.curve, ux), range);
            if (Math.abs(curveY - pos.y) <= 14) {
                var res = C.addAnchor(self.curve, ux);
                if (res.index > 0) {
                    self.activeAnchor = res.index;
                    self.setCurve(res.curve);
                }
            }
        });
    };

    EZGraph.prototype._mouse = function (e) {
        var r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    EZGraph.prototype._nearCurve = function (pos) {
        var ux = this._ux(pos.x);
        if (ux < 0.01 || ux > 0.99) { return false; }
        var range = this._valueRange();
        var curveY = this._gy(C.valueAt(this.curve, ux), range);
        return Math.abs(curveY - pos.y) <= 14;
    };

    // Remove the active mid anchor (Delete/Backspace shortcut). Returns true
    // when an anchor was actually removed.
    EZGraph.prototype.deleteActiveAnchor = function () {
        var i = this.activeAnchor;
        if (i === null || i <= 0 || i >= this.curve.anchors.length - 1) { return false; }
        this.activeAnchor = null;
        this.setCurve(C.removeAnchor(this.curve, i));
        return true;
    };

    EZGraph.prototype._hitTest = function (pos) {
        if (!this._hit) { return null; }
        var best = null, bestD = 14;
        var i;
        for (i = 0; i < this._hit.handles.length; i++) {
            var hd = this._hit.handles[i];
            var d = Math.hypot(pos.x - hd.px, pos.y - hd.py);
            if (d < bestD) { bestD = d; best = { kind: "handle", i: hd.i, side: hd.side }; }
        }
        // anchors win over handles at equal distance only if clearly closer
        for (i = 0; i < this._hit.anchors.length; i++) {
            var an = this._hit.anchors[i];
            var d2 = Math.hypot(pos.x - an.px, pos.y - an.py);
            if (d2 < bestD - 2) { bestD = d2; best = { kind: "anchor", i: an.i }; }
        }
        return best;
    };

    EZGraph.prototype._dragTo = function (pos, shiftHeld) {
        var range = this._dragRange || this._range();
        var anchors = C.cloneAnchors(this.curve);
        var guides = {};
        var upx = this._unitPerPxX();
        var upy = this._unitPerPxY(range);
        var ux = this._ux(pos.x);
        var uy = this._uy(pos.y, range);

        if (this.mode === "value") {
            if (this.drag.kind === "anchor") {
                var i = this.drag.i;
                var lo = anchors[i - 1].x + 0.01, hi = anchors[i + 1].x - 0.01;
                var sx = this._snapToLandmarks(Math.max(lo, Math.min(hi, ux)), VALUE_X_LANDMARKS, upx, shiftHeld);
                var sy = this._snapToLandmarks(uy, VALUE_Y_LANDMARKS, upy, shiftHeld);
                anchors[i].x = Math.max(lo, Math.min(hi, sx.v));
                anchors[i].y = sy.v;
                if (sx.guide !== undefined && anchors[i].x === sx.v) { guides.x = sx.guide; }
                if (sy.guide !== undefined) { guides.y = sy.guide; }
            } else {
                var a = anchors[this.drag.i];
                // handle point y snaps to the same landmarks
                var sh = this._snapToLandmarks(uy, VALUE_Y_LANDMARKS, upy, shiftHeld);
                var dx = Math.max(0, Math.min(1, ux)) - a.x;
                var dy = sh.v - a.y;
                if (this.drag.side === "out") { a.out = { dx: Math.max(0, dx), dy: dy }; }
                else { a.in = { dx: Math.min(0, dx), dy: dy }; }
                if (sh.guide !== undefined) { guides.y = sh.guide; }
            }
        } else {
            // speed mode: dx edits influence (5% steps), dy edits speed (landmarks)
            var vel = C.toVelocity(this.curve);
            var sSpd = this._snapToLandmarks(uy, SPEED_LANDMARKS, upy, shiftHeld);
            if (this.drag.side === "out") {
                var inflOut = Math.max(0.001, Math.min(1, ux));
                var sInf = this._snapToStep(inflOut, INFLUENCE_STEP, upx, shiftHeld);
                vel.outgoing.influence = Math.max(0.1, Math.min(100, sInf.v * 100));
                vel.outgoing.speed = sSpd.v;
                if (sInf.guide !== undefined) { guides.x = sInf.guide; }
            } else {
                var inflIn = Math.max(0.001, Math.min(1, 1 - ux));
                var sInf2 = this._snapToStep(inflIn, INFLUENCE_STEP, upx, shiftHeld);
                vel.incoming.influence = Math.max(0.1, Math.min(100, sInf2.v * 100));
                vel.incoming.speed = sSpd.v;
                if (sInf2.guide !== undefined) { guides.x = 1 - sInf2.guide; }
            }
            if (sSpd.guide !== undefined) { guides.y = sSpd.guide; }
            this._snapGuides = (guides.x !== undefined || guides.y !== undefined) ? guides : null;
            this.setCurve(C.fromVelocity(vel, this.curve));
            return;
        }

        this._snapGuides = (guides.x !== undefined || guides.y !== undefined) ? guides : null;
        this.setCurve({ anchors: anchors });
    };

    root.EZGraph = EZGraph;
}(typeof self !== "undefined" ? self : this));
