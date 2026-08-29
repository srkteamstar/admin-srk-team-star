const { supabase } = require('../database/supabase');

function isMissingObject(error) {
    if (!error) return false;
    const status = Number(error.statusCode || error.status);
    const message = String(error.message || '').toLowerCase();
    return status === 404 || message.includes('not found') || message.includes('does not exist');
}

async function readStorageSnapshot(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) {
        if (isMissingObject(error)) return null;
        throw error;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    return { buffer, contentType: data.type || 'application/octet-stream' };
}

async function restoreStorageSnapshot(bucket, path, snapshot) {
    const store = supabase.storage.from(bucket);
    if (!snapshot) {
        const { error } = await store.remove([path]);
        if (error && !isMissingObject(error)) throw error;
        return;
    }
    const { error } = await store.upload(path, snapshot.buffer, {
        contentType: snapshot.contentType,
        upsert: true
    });
    if (error) throw error;
}

async function removeStorageObject(bucket, path) {
    const snapshot = await readStorageSnapshot(bucket, path);
    if (!snapshot) return null;
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error && !isMissingObject(error)) throw error;
    return snapshot;
}

module.exports = {
    isMissingObject,
    readStorageSnapshot,
    restoreStorageSnapshot,
    removeStorageObject
};
