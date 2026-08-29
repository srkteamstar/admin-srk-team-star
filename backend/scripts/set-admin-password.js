/*
 * Operator-only admin credential setter.
 *
 * Usage from the repository root:
 *   npm --prefix backend run set-admin-password -- admin@example.com
 *
 * The password is read without echo and is never accepted on the command line,
 * where it would remain in shell history. Only the scrypt hash is sent to the
 * shared Supabase project.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { supabase } = require('../src/core/database/supabase');
const { resolveIdentifier } = require('../src/modules/auth/services/session.service');
const { passwordProblem, hashAdminPassword } = require('../src/modules/auth/services/admin-password.service');

function readHidden(prompt) {
    return new Promise((resolve, reject) => {
        if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
            return reject(new Error('Run this command in an interactive terminal.'));
        }

        let value = '';
        const finish = (error) => {
            process.stdin.off('data', onData);
            process.stdin.setRawMode(false);
            process.stdin.pause();
            process.stdout.write('\n');
            if (error) reject(error);
            else resolve(value);
        };
        const onData = (chunk) => {
            for (const character of String(chunk)) {
                if (character === '\u0003') return finish(new Error('Cancelled.'));
                if (character === '\r' || character === '\n') return finish();
                if (character === '\u0008' || character === '\u007f') {
                    value = value.slice(0, -1);
                } else if (character >= ' ') {
                    value += character;
                }
            }
        };

        process.stdout.write(prompt);
        process.stdin.setEncoding('utf8');
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
    });
}

async function main() {
    const identifier = process.argv.slice(2).join(' ').trim();
    if (!identifier) {
        throw new Error('Provide the administrator email or phone number after --.');
    }
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
        throw new Error('backend/.env must contain SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    }

    const profile = await resolveIdentifier(identifier);
    if (!profile) throw new Error('No profile matches that identifier.');

    const { data: role, error: roleError } = await supabase
        .from('roles')
        .select('role_name')
        .eq('id', profile.role_id)
        .maybeSingle();
    if (roleError) throw roleError;
    if (!role || role.role_name !== 'admin') {
        throw new Error('That profile is not an administrator. This command never changes roles.');
    }

    const password = await readHidden('New administrator password: ');
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);

    const confirmation = await readHidden('Confirm administrator password: ');
    if (confirmation !== password) throw new Error('The passwords do not match.');

    const passwordHash = await hashAdminPassword(password);
    const { error: updateError } = await supabase
        .from('user_profiles')
        .update({ password_hash: passwordHash })
        .eq('id', profile.id);
    if (updateError) throw updateError;

    console.log(`Password updated for administrator ${profile.email || profile.phone_number || profile.id}.`);
    console.log('The plaintext password was not stored or logged.');
}

main().catch((error) => {
    console.error(`Could not set administrator password: ${error.message || error}`);
    process.exitCode = 1;
});
