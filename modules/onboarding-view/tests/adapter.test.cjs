const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

// Execute the actual adapter with service/hook doubles; no React Native runtime or network.
const source = fs.readFileSync(path.join(__dirname, '../../../src/features/onboarding/NativeOnboardingScreen.tsx'), 'utf8');
const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
const result = (id, title) => ({ track: { id, title, artist: 'Artist' }, match: { username: 'peer', filename: `${title}.flac`, format: 'flac', size: 31 * 1024 * 1024 } });

function harness({ granted = true, scanFails = false, stored = null, found = [result(7, 'Song')], download, saveFails = false } = {}) {
    const calls = [], replies = [], cleanups = [];
    const store = {
        setUserName: value => calls.push(['setUserName', value]),
        completeOnboarding: () => calls.push(['completeOnboarding']),
    };
    const react = {
        useCallback: fn => fn, useMemo: fn => fn(), useRef: current => ({ current }),
        useEffect: fn => cleanups.push(fn()),
        // The only state in the adapter is the reply mailbox.
        useState: () => [replies, next => { const values = next(replies); replies.splice(0, replies.length, ...values); }],
    };
    const mocks = {
        react,
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
        'react-native': { Platform: { OS: 'android' }, Image: { resolveAssetSource: () => ({ uri: 'asset://logo' }) } },
        'expo-modules-core': { requireOptionalNativeModule: () => ({}), requireNativeViewManager: () => 'NativeView' },
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
        '@/assets/images/appicon.png': {},
        '@/src/theme': { useTheme: () => ({ theme: { colors: { background: '#000', elevation: {} } } }) },
        '@/src/stores/onboardingStore': { useOnboardingStore: { getState: () => store } },
        '@/src/stores': {
            useLibraryStore: { getState: () => ({ scanLibrary: async () => { calls.push(['scan']); if (scanFails) throw Error('scan failed'); } }) },
            useSettingsStore: { getState: () => ({ tidalDownloadQuality: 'MP3' }) },
        },
        '@/src/services/fileScanner': { hasPermissions: async () => granted, requestPermissions: async () => granted },
        '@/src/services/soulseekDownloadService': {
            getSoulseekCredentials: async () => stored,
            setSoulseekCredentials: async (username, password) => { calls.push(['credentials', username, password]); if (saveFails) throw Error('sin red'); },
            searchSoulseekTracksByQuery: async (query, quality) => { calls.push(['search', query, quality]); return found; },
        },
        '@/src/hooks/useTidalDownload': { useTidalDownload: () => ({
            downloads: new Map(),
            downloadFromSoulseekMatch: async (track, match, options) => { calls.push(['download', track.id, options]); if (download) await download(); },
        }) },
    };
    const context = { module: { exports: {} }, require: id => {
        assert.ok(id in mocks, `Unmocked dependency: ${id}`); return mocks[id];
    } };
    vm.runInNewContext(code, context);
    const component = context.module.exports.default();
    const send = (action, payload = {}, id = 1) => component.props.onAction({ nativeEvent: { action, id, payload: JSON.stringify(payload), snapshot: '{}' } });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    return { send, calls, replies, flush, props: component.props, unmount: () => cleanups.forEach(fn => fn?.()) };
}

test('denied permission never scans and a scanner failure still reports granted', async () => {
    const denied = harness({ granted: false }); denied.send('permission'); await denied.flush();
    assert.equal(denied.calls.some(c => c[0] === 'scan'), false);
    assert.equal(denied.replies[0].data.granted, false);
    const failed = harness({ scanFails: true }); failed.send('permission'); await failed.flush();
    assert.equal(failed.replies.length, 1);
    assert.equal(failed.replies[0].data.granted, true);
});
test('account reports stored credentials without exposing the password', async () => {
    const h = harness({ stored: { username: 'ana', password: 'secret' } }); h.send('account'); await h.flush();
    assert.deepEqual({ ...h.replies[0].data }, { connected: true, username: 'ana' });
    const empty = harness(); empty.send('account'); await empty.flush();
    assert.equal(empty.replies[0].data.connected, false);
});
test('credentials are saved, and a failure is answered with its reason', async () => {
    const h = harness(); h.send('credentials', { username: 'ana', password: 'secret' }); await h.flush();
    assert.deepEqual(h.calls[0], ['credentials', 'ana', 'secret']);
    assert.equal(h.replies[0].data.saved, true);
    const failed = harness({ saveFails: true }); failed.send('credentials', { username: 'ana', password: 'x' }); await failed.flush();
    assert.equal(failed.replies[0].data.error, 'sin red');
});
test('search offers at most six results and download uses the chosen one', async () => {
    const found = Array.from({ length: 9 }, (_, index) => result(index + 1, `Song ${index}`));
    const h = harness({ found }); h.send('search', { query: 'song' }); await h.flush();
    const results = h.replies[0].data.results;
    assert.equal(results.length, 6);
    assert.equal(results[2].detail, 'FLAC · 31 MB');
    h.send('download', { id: results[2].id }, 2); await h.flush();
    const download = h.calls.find(c => c[0] === 'download');
    assert.equal(download[1], 3);
    assert.equal(download[2].allowCompressedFallback, true);
    assert.equal(h.replies[1].data.done, true);
});
test('a failed or unknown download is answered instead of left hanging', async () => {
    const h = harness({ download: () => { throw Error('cola llena'); } });
    h.send('search', { query: 'song' }); await h.flush();
    h.send('download', { id: h.replies[0].data.results[0].id }, 2); await h.flush();
    assert.equal(h.replies[1].data.error, 'cola llena');
    h.send('download', { id: 'gone' }, 3); await h.flush();
    assert.match(h.replies[2].data.error, /Busca de nuevo/);
});
test('finish stores a trimmed name once and completes once', async () => {
    const h = harness(); h.send('finish', { name: '  Ana  ' }); await h.flush();
    assert.deepEqual(h.calls[0], ['setUserName', 'Ana']);
    assert.equal(h.replies[0].data.success, true);
    h.send('completed'); h.send('completed'); await h.flush();
    assert.equal(h.calls.filter(c => c[0] === 'completeOnboarding').length, 1);
    const anonymous = harness(); anonymous.send('finish', { name: '  ' }); await anonymous.flush();
    assert.equal(anonymous.calls.some(c => c[0] === 'setUserName'), false);
});
test('unmount after an accepted finish still completes', async () => {
    const h = harness(); h.send('finish', { name: '' }); await h.flush(); h.unmount();
    assert.equal(h.calls.filter(c => c[0] === 'completeOnboarding').length, 1);
});
