/**
 * CSInterface - Adobe CEP Communication Library
 * Wraps the __adobe_cep__ runtime for ExtendScript evaluation,
 * event handling, and system path resolution.
 */

var SystemPath = {
    USER_DATA: "userData",
    COMMON_FILES: "commonFiles",
    MY_DOCUMENTS: "myDocuments",
    APPLICATION: "application",
    EXTENSION: "extension",
    HOST_APPLICATION: "hostApplication"
};

var ColorType = {
    RGB: "rgb",
    GRADIENT: "gradient",
    NONE: "none"
};

function CSEvent(type, scope, appId, extensionId) {
    this.type = type;
    this.scope = scope || "APPLICATION";
    this.appId = appId || "";
    this.extensionId = extensionId || "";
    this.data = "";
}

function CSInterface() {}

CSInterface.prototype.getHostEnvironment = function () {
    try {
        var env = window.__adobe_cep__.getHostEnvironment();
        return typeof env === "string" ? JSON.parse(env) : env;
    } catch (e) {
        return null;
    }
};

CSInterface.prototype.evalScript = function (script, callback) {
    if (!callback) callback = function () {};
    try {
        window.__adobe_cep__.evalScript(script, callback);
    } catch (e) {
        callback("EvalScript Error: " + e.message);
    }
};

CSInterface.prototype.getSystemPath = function (pathType) {
    try {
        var path = decodeURI(window.__adobe_cep__.getSystemPath(pathType));
        if (navigator.platform.indexOf("Win") >= 0) {
            path = path.replace("file:///", "");
        } else {
            path = path.replace("file://", "");
        }
        return path;
    } catch (e) {
        return "";
    }
};

CSInterface.prototype.addEventListener = function (type, listener, obj) {
    try {
        window.__adobe_cep__.addEventListener(type, listener, obj);
    } catch (e) {}
};

CSInterface.prototype.removeEventListener = function (type, listener, obj) {
    try {
        window.__adobe_cep__.removeEventListener(type, listener, obj);
    } catch (e) {}
};

CSInterface.prototype.dispatchEvent = function (event) {
    if (!event || !event.type) return;
    try {
        if (typeof event.data === "object") {
            event.data = JSON.stringify(event.data);
        }
        window.__adobe_cep__.dispatchEvent(event);
    } catch (e) {}
};

CSInterface.prototype.requestOpenExtension = function (extensionId, params) {
    try {
        window.__adobe_cep__.requestOpenExtension(extensionId, params || "");
    } catch (e) {}
};

CSInterface.prototype.closeExtension = function () {
    try {
        window.__adobe_cep__.closeExtension();
    } catch (e) {}
};

CSInterface.prototype.getExtensionID = function () {
    return this.getExtensionId();
};

CSInterface.prototype.getExtensionId = function () {
    try {
        return window.__adobe_cep__.getExtensionId();
    } catch (e) {
        return "com.colden.alphatrimmer.panel";
    }
};

CSInterface.prototype.getOSInformation = function () {
    var info = navigator.userAgent;
    if (navigator.platform) {
        info = navigator.platform;
    }
    return info;
};

CSInterface.prototype.openURLInDefaultBrowser = function (url) {
    if (typeof cep !== "undefined" && cep.util) {
        cep.util.openURLInDefaultBrowser(url);
    }
};

CSInterface.prototype.getNetworkPreferences = function () {
    try {
        var result = window.__adobe_cep__.getNetworkPreferences();
        return typeof result === "string" ? JSON.parse(result) : result;
    } catch (e) {
        return null;
    }
};
