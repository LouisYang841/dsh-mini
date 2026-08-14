// Operit host bootstrap: install the shim-layer timers when the QuickJS host
// does not provide them. Engine compatibility behavior lives in shims/, not
// here; process/console fallbacks are already owned by polyfills.js.
import {
setTimeout as shimSetTimeout,
setInterval as shimSetInterval,
clearTimeout as shimClearTimeout,
clearInterval as shimClearInterval,
setImmediate as shimSetImmediate,
clearImmediate as shimClearImmediate,
} from "../../shims/timers.js";

if (typeof globalThis.setTimeout === "undefined") globalThis.setTimeout = shimSetTimeout;
if (typeof globalThis.setInterval === "undefined") globalThis.setInterval = shimSetInterval;
if (typeof globalThis.clearTimeout === "undefined") globalThis.clearTimeout = shimClearTimeout;
if (typeof globalThis.clearInterval === "undefined") globalThis.clearInterval = shimClearInterval;
if (typeof globalThis.setImmediate === "undefined") globalThis.setImmediate = shimSetImmediate;
if (typeof globalThis.clearImmediate === "undefined") globalThis.clearImmediate = shimClearImmediate;
