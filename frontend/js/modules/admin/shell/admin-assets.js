/* Classic browser scripts, loaded only when an authenticated screen needs them.
 * The inert templates in index.html are the asset manifest, so verify-links
 * still checks every dependency against the server's static mounts.
 */
(function () {
    'use strict';

    const requests = new Map();
    let shellReady;

    function load(source, stylesheet) {
        if (requests.has(source)) return requests.get(source);
        const element = document.createElement(stylesheet ? 'link' : 'script');
        if (stylesheet) {
            element.rel = 'stylesheet';
            element.href = source;
        } else {
            element.src = source;
            // Dynamic classic scripts with async=false execute in insertion
            // order while their downloads can overlap.
            element.async = false;
        }
        const request = new Promise((resolve, reject) => {
            element.onload = () => resolve();
            element.onerror = () => {
                requests.delete(source);
                element.remove();
                reject(new Error('Could not load dashboard asset: ' + source));
            };
        });
        requests.set(source, request);
        document.head.appendChild(element);
        return request;
    }

    const tabAssets = new Map(Array.from(
        document.getElementById('admin-tab-assets').content.querySelectorAll('script[data-tab]'),
        node => [node.dataset.tab, node]
    ));

    function loadShell() {
        if (!shellReady) {
            const manifest = document.getElementById('admin-shell-assets').content;
            shellReady = Promise.all([
                ...Array.from(manifest.querySelectorAll('link[rel="stylesheet"]'),
                    node => load(node.getAttribute('href'), true)),
                ...Array.from(manifest.querySelectorAll('script[src]'),
                    node => load(node.getAttribute('src'), false))
            ]).catch(error => {
                shellReady = null;
                throw error;
            });
        }
        return shellReady;
    }

    async function loadTab(name) {
        const asset = tabAssets.get(name);
        if (!asset) throw new Error('Unknown dashboard section');
        await loadShell();
        // Tabs use the overview's shared UI helpers; the product editor also
        // uses the category module's toggle controls. Neither dependency fetches
        // data until its renderer is actually called.
        if (asset.dataset.dependsOn) await loadTab(asset.dataset.dependsOn);
        await load(asset.getAttribute('src'), false);
    }

    window.adminAssets = { loadShell, loadTab, hasTab: name => tabAssets.has(name) };
})();
