/* Motion Ease host bridge — the ONLY place that talks to ExtendScript.
 *
 * Every call loads engine.jsx and invokes the function in a single evalScript
 * (evalFile definitions do not persist across evalScript calls in PPro 2026 —
 * see PHASE0-RESULTS.md). This also hot-reloads engine edits during dev.
 *
 * ezCall(fn)            -> Promise<object>
 * ezCall(fn, argObject) -> Promise<object>   (arg is JSON round-tripped)
 * Rejections carry readable error messages for the status line.
 */
(function (root) {
    "use strict";
    var cs = new CSInterface();
    var extPath = cs.getSystemPath(SystemPath.EXTENSION);
    // one panel, two hosts: Premiere gets the baking engine, After Effects
    // gets the AE engine (true temporal ease + scriptable Time Remap)
    var hostApp = "PPRO";
    try { hostApp = cs.getHostEnvironment().appName; } catch (e) {}
    // embutido no plugin EP como sub-app em /ease (iframe) — engine mora em /ease/host
    var enginePath = extPath + (hostApp === "AEFT" ? "/ease/host/engine-ae.jsx" : "/ease/host/engine.jsx");
    // engine.jsx usa JSON.parse/stringify — o ExtendScript não tem JSON nativo. O loader normal (index.jsx) inclui
    // json2.jsx antes; como aqui carregamos por evalFile (não pelo ScriptPath), carregamos o json2 antes em CADA
    // chamada (evalFile não persiste entre evalScripts no PPro 2026).
    var json2Path = extPath + "/ease/host/json2.jsx";

    function ezCall(fn, argObj) {
        return new Promise(function (resolve, reject) {
            var argLit = (argObj === undefined) ? "" : JSON.stringify(JSON.stringify(argObj));
            var script = "$.evalFile(File(" + JSON.stringify(json2Path) + ")); $.evalFile(File(" + JSON.stringify(enginePath) + ")); " + fn + "(" + argLit + ")";
            cs.evalScript(script, function (raw) {
                if (raw === undefined || raw === null || raw === "" || raw === "undefined") {
                    reject(new Error(fn + ": empty response from Premiere"));
                    return;
                }
                if (raw === "EvalScript error.") {
                    reject(new Error(fn + ": ExtendScript crashed (EvalScript error) — check engine.jsx syntax"));
                    return;
                }
                var parsed;
                try { parsed = JSON.parse(raw); }
                catch (e) { reject(new Error(fn + ": bad JSON from host: " + raw.slice(0, 200))); return; }
                if (parsed && parsed.ok === false) { reject(new Error(parsed.error || (fn + " failed"))); return; }
                resolve(parsed);
            });
        });
    }

    root.EZHost = { call: ezCall, extPath: extPath, hostApp: hostApp };
}(typeof self !== "undefined" ? self : this));
