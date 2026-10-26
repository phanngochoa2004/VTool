/**
 * Chrome Content Script Bridge
 * Injects the module injector directly into the page's MAIN execution world.
 */

(function injectMainModule() {
    const script = document.createElement('script');
    script.type = 'module';
    script.src = chrome.runtime.getURL('content/injector.js');
    (document.head || document.documentElement).appendChild(script);
})();
