const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const { buildPublic } = require('./build-vercel-public');

function fixture(t) {
    const temporaryRoot = fs.realpathSync(os.tmpdir());
    const project = fs.mkdtempSync(path.join(temporaryRoot, 'srk-public-build-'));
    t.after(() => {
        const resolved = fs.realpathSync(project);
        assert.equal(path.dirname(resolved), temporaryRoot);
        assert.ok(path.basename(resolved).startsWith('srk-public-build-'));
        fs.rmSync(resolved, { recursive: true, force: true });
    });
    const write = (relative, content) => {
        const destination = path.resolve(project, relative);
        assert.ok(destination.startsWith(project + path.sep));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, content);
    };
    const firstScript = `
        // Keep this source readable. Only the deployed copy is minified.
        const referencePrefix = 'SRK';
        function formatReference(reference) {
            const formattedReference = referencePrefix + ':' + reference;
            return formattedReference;
        }
        function inlineOnlyHandler() {
            return 'reachable from inline markup';
        }
        window.renderDemo = function (reference) {
            return formatReference(reference);
        };
    `;
    const secondScript = `
        window.renderFromAnotherScript = function () {
            return formatReference('second') + ':' + referencePrefix;
        };
    `;
    const css = `
        /* Authored styles stay readable. */
        @font-face {
            font-family: 'Fixture';
            src: url('./font.woff2') format('woff2');
        }
        .brand {
            --brand: #123456;
            color: var(--brand);
            padding: 0px 0px 0px 0px;
        }
    `;
    const image = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0xff, 0x57, 0x45, 0x42, 0x50]);
    write('frontend/js/first.js', firstScript);
    write('frontend/js/nested/second.js', secondScript);
    write('frontend/assets/style.css', css);
    write('frontend/assets/logo.webp', image);
    write('frontend/assets/font.woff2', image);
    write('frontend/public/robots.txt', 'User-agent: *\nDisallow: /\n');
    write('frontend/pages/index.html', '<html>Private console shell</html>');
    write('backend/private.txt', 'Must not be copied');
    return { project, write, firstScript, secondScript, css, image };
}

test('deployment copies are smaller without changing classic-script interfaces or authored sources', t => {
    const { project, firstScript, secondScript, css, image } = fixture(t);
    const stats = buildPublic(project);
    const read = relative => fs.readFileSync(path.join(project, relative), 'utf8');
    const generatedFirst = read('public/js/first.js');
    const generatedSecond = read('public/js/nested/second.js');

    assert.ok(generatedFirst.length < firstScript.length);
    assert.ok(read('public/assets/style.css').length < css.length);
    assert.ok(stats.js.after < stats.js.before);
    assert.ok(stats.css.after < stats.css.before);
    assert.equal(read('frontend/js/first.js'), firstScript);
    assert.equal(read('frontend/js/nested/second.js'), secondScript);
    assert.equal(read('frontend/assets/style.css'), css);

    const browser = vm.createContext({});
    browser.window = browser;
    vm.runInContext(generatedFirst, browser);
    vm.runInContext(generatedSecond, browser);
    assert.equal(browser.renderDemo('123'), 'SRK:123');
    assert.equal(browser.renderFromAnotherScript(), 'SRK:second:SRK');
    assert.equal(vm.runInContext('inlineOnlyHandler()', browser), 'reachable from inline markup');
    assert.equal(vm.runInContext('formatReference.name', browser), 'formatReference');

    assert.match(read('public/assets/style.css'), /font\.woff2/);
    assert.match(read('public/assets/style.css'), /--brand/);
    assert.deepEqual(fs.readFileSync(path.join(project, 'public/assets/logo.webp')), image);
    assert.deepEqual(fs.readFileSync(path.join(project, 'public/assets/font.woff2')), image);
    assert.equal(read('public/robots.txt'), 'User-agent: *\nDisallow: /\n');
    for (const privatePath of ['index.html', 'frontend', 'backend', 'pages']) {
        assert.equal(fs.existsSync(path.join(project, 'public', privatePath)), false);
    }
});

test('rebuilding removes stale deployment files and picks up the current sources', t => {
    const { project, write } = fixture(t);
    buildPublic(project);
    write('public/js/retired.js', 'window.retired = true;');
    write('frontend/js/first.js', 'window.currentVersion = 2;');
    buildPublic(project);
    assert.equal(fs.existsSync(path.join(project, 'public/js/retired.js')), false);
    const browser = vm.createContext({});
    browser.window = browser;
    vm.runInContext(fs.readFileSync(path.join(project, 'public/js/first.js'), 'utf8'), browser);
    assert.equal(browser.currentVersion, 2);
});

test('an unowned public directory is never removed', t => {
    const { project, write } = fixture(t);
    write('public/keep.txt', 'Hand-authored file');
    assert.throws(() => buildPublic(project), /Refusing to replace public/);
    assert.equal(fs.readFileSync(path.join(project, 'public/keep.txt'), 'utf8'), 'Hand-authored file');
});

test('invalid JavaScript fails the deployment build and can be corrected without manual cleanup', t => {
    const { project, write } = fixture(t);
    write('frontend/js/first.js', 'function ( {');
    assert.throws(() => buildPublic(project), /Transform failed/);
    write('frontend/js/first.js', 'window.corrected = true;');
    assert.doesNotThrow(() => buildPublic(project));
    assert.match(fs.readFileSync(path.join(project, 'public/js/first.js'), 'utf8'), /window\.corrected/);
});
