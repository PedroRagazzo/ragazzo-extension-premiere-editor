// Editor de curva de Bézier cúbica, visual e arrastável (SVG + mouse), original.
// P0 = (0,0) e P3 = (1,1) são fixos; o usuário arrasta P1 e P2.

(function (global) {
  var PAD_X = 20, PLOT_W = 200, Y0 = 200, Y1 = 60, PLOT_H = Y0 - Y1;
  var YMIN = -0.5, YMAX = 1.5;
  var VIEW_W = 240, VIEW_H = 260;
  var svgNS = "http://www.w3.org/2000/svg";

  function px(x) { return PAD_X + x * PLOT_W; }
  function py(v) { return Y0 - v * PLOT_H; }

  function pathD(points) {
    var sx = px(0), sy = py(0), ex = px(1), ey = py(1);
    var h1x = px(points[0]), h1y = py(points[1]);
    var h2x = px(points[2]), h2y = py(points[3]);
    return "M " + sx + " " + sy + " C " + h1x + " " + h1y + " " + h2x + " " + h2y + " " + ex + " " + ey;
  }

  function el(tag, attrs) {
    var e = document.createElementNS(svgNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  function makeThumb(points) {
    var svg = el("svg", { viewBox: "0 0 " + VIEW_W + " " + VIEW_H, class: "curve-thumb-svg" });
    svg.appendChild(el("rect", { x: PAD_X, y: Y1, width: PLOT_W, height: PLOT_H, class: "curve-plot-bg" }));
    svg.appendChild(el("line", { x1: PAD_X, y1: Y0, x2: PAD_X + PLOT_W, y2: Y0, class: "curve-axis" }));
    svg.appendChild(el("path", { d: pathD(points), class: "curve-path curve-thumb-path" }));
    return svg;
  }

  function create(container, opts) {
    opts = opts || {};
    var points = (opts.points || [0.42, 0, 0.58, 1]).slice();
    var onChange = opts.onChange || function () {};

    function invX(pxVal) { return Math.max(0, Math.min(1, (pxVal - PAD_X) / PLOT_W)); }
    function invY(pyVal) { return Math.max(YMIN, Math.min(YMAX, (Y0 - pyVal) / PLOT_H)); }

    var svg = el("svg", { viewBox: "0 0 " + VIEW_W + " " + VIEW_H, class: "curve-editor-svg" });

    svg.appendChild(el("rect", { x: PAD_X, y: Y1, width: PLOT_W, height: PLOT_H, class: "curve-plot-bg" }));
    svg.appendChild(el("line", { x1: PAD_X, y1: Y0, x2: PAD_X + PLOT_W, y2: Y0, class: "curve-axis" }));
    svg.appendChild(el("line", { x1: PAD_X, y1: Y1, x2: PAD_X + PLOT_W, y2: Y1, class: "curve-axis-soft" }));

    var handleLine1 = el("line", { class: "curve-handle-line" });
    var handleLine2 = el("line", { class: "curve-handle-line" });
    var curvePath = el("path", { class: "curve-path" });
    var anchorStart = el("circle", { r: 3.5, class: "curve-anchor" });
    var anchorEnd = el("circle", { r: 3.5, class: "curve-anchor" });
    var handle1 = el("circle", { r: 6, class: "curve-handle" });
    var handle2 = el("circle", { r: 6, class: "curve-handle" });

    [handleLine1, handleLine2, curvePath, anchorStart, anchorEnd, handle1, handle2].forEach(function (n) {
      svg.appendChild(n);
    });

    container.innerHTML = "";
    container.appendChild(svg);

    function render() {
      curvePath.setAttribute("d", pathD(points));
      var sx = px(0), sy = py(0), ex = px(1), ey = py(1);
      var h1x = px(points[0]), h1y = py(points[1]);
      var h2x = px(points[2]), h2y = py(points[3]);

      handleLine1.setAttribute("x1", sx); handleLine1.setAttribute("y1", sy);
      handleLine1.setAttribute("x2", h1x); handleLine1.setAttribute("y2", h1y);
      handleLine2.setAttribute("x1", ex); handleLine2.setAttribute("y1", ey);
      handleLine2.setAttribute("x2", h2x); handleLine2.setAttribute("y2", h2y);
      anchorStart.setAttribute("cx", sx); anchorStart.setAttribute("cy", sy);
      anchorEnd.setAttribute("cx", ex); anchorEnd.setAttribute("cy", ey);
      handle1.setAttribute("cx", h1x); handle1.setAttribute("cy", h1y);
      handle2.setAttribute("cx", h2x); handle2.setAttribute("cy", h2y);
    }

    function svgPoint(evt) {
      var rect = svg.getBoundingClientRect();
      return {
        x: (evt.clientX - rect.left) * (VIEW_W / rect.width),
        y: (evt.clientY - rect.top) * (VIEW_H / rect.height)
      };
    }

    function startDrag(idx) {
      return function (evt) {
        evt.preventDefault();
        function move(e) {
          var pt = svgPoint(e);
          var nx = invX(pt.x), ny = invY(pt.y);
          if (idx === 1) { points[0] = nx; points[1] = ny; }
          else { points[2] = nx; points[3] = ny; }
          render();
          onChange(points.slice());
        }
        function up() {
          document.removeEventListener("mousemove", move);
          document.removeEventListener("mouseup", up);
        }
        document.addEventListener("mousemove", move);
        document.addEventListener("mouseup", up);
      };
    }

    handle1.addEventListener("mousedown", startDrag(1));
    handle2.addEventListener("mousedown", startDrag(2));

    render();

    return {
      setPoints: function (p) { points = p.slice(); render(); onChange(points.slice()); },
      getPoints: function () { return points.slice(); }
    };
  }

  global.CurveEditor = { create: create, makeThumb: makeThumb };
})(window);
