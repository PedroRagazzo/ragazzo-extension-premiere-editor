// Easify — ExtendScript host entry (loaded by CEP via ScriptPath).
// ES3. json2 provides JSON.parse/stringify for the bridge.
// NOTE: ScriptPath-loaded definitions persist across evalScript calls;
// $.evalFile-loaded ones do NOT (PPro 2026, see PHASE0-RESULTS.md). The panel
// bridge therefore uses load+call-in-one-evalScript, which also hot-reloads
// host code edits without restarting Premiere.
#include "json2.jsx"
#include "engine.jsx"

var EF_HOST_VERSION = "0.1.0";

function ef_ping() {
    return "pong " + EF_HOST_VERSION + " | app " + app.version;
}

// Load/reload a jsx file from the extension folder at runtime so the panel
// can iterate without restarting Premiere.
function ef_load(path) {
    try {
        $.evalFile(File(path));
        return "loaded:" + path;
    } catch (e) {
        return "ERR loading " + path + ": " + e;
    }
}
