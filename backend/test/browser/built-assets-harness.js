// Run the real app and fake database with the files produced for Vercel's CDN.
// Only static mount directories change; authentication, APIs and CSP do not.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../../..');
const { STATIC_MOUNTS } = require('../../src/core/config/static-mounts');

for (const mount of STATIC_MOUNTS) {
    if (mount.urlPrefix !== '/js' && mount.urlPrefix !== '/assets') continue;
    const built = path.join(root, 'public', mount.urlPrefix.slice(1));
    if (!fs.existsSync(built)) throw new Error('Run npm run build before testing generated assets.');
    mount.dir = built;
}

require('../authz-harness');
