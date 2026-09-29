const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync } = require('esbuild');

// Execute the actual adapter with service/hook doubles; no React Native runtime or network.
const source = fs.readFileSync(path.join(__dirname, '../../../src/features/onboarding/NativeOnboardingScreen.tsx'), 'utf8');
const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
function harness({ generation, granted = true, scanFails = false } = {}) {
    const calls = [], replies = [], cleanups = [];
    let stateIndex = 0;
    const store = { tasteArtists: [] };
    for (const name of ['setUserName', 'setUserAvatarUri', 'setTasteProfileVersion', 'setTasteArtists', 'setTasteTrackIds',
        'setTastePlaylistStatus', 'markTastePlaylistGenerated', 'completeOnboarding']) {
        store[name] = value => calls.push([name, value]);
    }
    const react = {
        useCallback: fn => fn, useMemo: fn => fn(), useRef: current => ({ current }),
        useEffect: fn => cleanups.push(fn()),
        useState: initial => {
            const index = stateIndex++;
            return [initial, next => { if (index === 1) { const values = next(replies); replies.splice(0, replies.length, ...values); } }];
        },
    };
    const mocks = {
        react,
        'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
        'react-native': { Platform: { OS: 'android' }, Image: { resolveAssetSource: () => ({ uri: 'asset://logo' }) } },
        'expo-modules-core': { requireOptionalNativeModule: () => ({}), requireNativeViewManager: () => 'NativeView' },
        'expo-router': { router: { replace: route => calls.push(['route', route]) }, useRootNavigationState: () => ({ key: 'root' }) },
        'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) },
        'expo-image-picker': {},
        '@/assets/images/appicon.png': {},
        '@/src/hooks/useDynamicColors': { useDynamicColors: () => ({ colors: {} }) },
        '@/src/i18n': { useI18n: () => ({ t: key => key }) },
        '@/src/theme': { useTheme: () => ({ theme: { colors: { background: '#000' } }, config: { lightweightMode: false } }) },
        '@/src/stores/onboardingStore': { useOnboardingStore: { getState: () => store } },
        '@/src/stores': { useLibraryStore: { getState: () => ({ scanLibrary: async () => {
            calls.push(['scan']); if (scanFails) throw Error('scan failed');
        } }) } },
        '@/src/services/fileScanner': { hasPermissions: async () => granted, requestPermissions: async () => granted },
        '@/src/services/tidalService': {},
        './onboardingServices': {},
        '@/src/services/onboardingTasteService': {
            ONBOARDING_TASTE_PROFILE_VERSION: 42,
            buildOnboardingMirrorPlaylist: async payload => { calls.push(['build', payload]); return generation ? generation() : { tracks: [] }; },
            applyOnboardingMirrorPlaylist: payload => calls.push(['apply', payload]),
        },
    };
    const context = { module: { exports: {} }, require: id => {
        assert.ok(id in mocks, `Unmocked dependency: ${id}`); return mocks[id];
    } };
    vm.runInNewContext(code, context);
    const component = context.module.exports.default();
    const send = (action, payload = {}, id = 1) => component.props.onAction({ nativeEvent: { action, id, payload: JSON.stringify(payload), snapshot: '{}' } });
    const flush = () => new Promise(resolve => setImmediate(resolve));
    return { send, calls, replies, flush, unmount: () => cleanups.forEach(fn => fn?.()) };
}
const profile = count => ({ name: '  Jacob  ', avatarUri: 'file:///avatar', artists: Array.from({ length: count }, (_, id) => ({ id, name: `Artist ${id}` })) });

test('finish preserves persistence order, successful generation and one completion', async () => {
    const h = harness(); h.send('finish', profile(3)); await h.flush();
    assert.deepEqual(h.calls.map(c => c[0]), ['setUserName', 'setUserAvatarUri', 'setTasteProfileVersion', 'setTasteArtists',
        'setTasteTrackIds', 'setTastePlaylistStatus', 'build', 'apply', 'markTastePlaylistGenerated']);
    assert.equal(h.calls[0][1], 'Jacob'); assert.equal(h.calls[5][1], 'pending');
    assert.equal(h.replies[0].data.success, true);
    h.send('completed'); h.send('completed'); h.send('finish', profile(3)); await h.flush();
    assert.equal(h.calls.filter(c => c[0] === 'completeOnboarding').length, 1);
    assert.equal(h.calls.filter(c => c[0] === 'route').length, 1);
    assert.equal(h.calls.filter(c => c[0] === 'build').length, 1);
});
test('generation failure persists failed and still completes', async () => {
    const h = harness({ generation: () => { throw Error('offline'); } });
    h.send('finish', profile(3)); await h.flush();
    assert.deepEqual(h.calls.filter(c => c[0] === 'setTastePlaylistStatus').map(c => c[1]), ['pending', 'failed']);
    assert.equal(h.calls.some(c => c[0] === 'markTastePlaylistGenerated'), false);
    assert.equal(h.replies[0].data.success, true);
    h.send('completed'); await h.flush();
    assert.equal(h.calls.filter(c => c[0] === 'completeOnboarding').length, 1);
});
test('skip preserves partial preferences and leaves existing name and avatar when empty', async () => {
    const h = harness(); h.send('finish', { ...profile(2), name: '  ', avatarUri: '' }); await h.flush();
    assert.equal(h.calls.some(c => ['setUserName', 'setUserAvatarUri', 'build'].includes(c[0])), false);
    assert.equal(h.calls.find(c => c[0] === 'setTasteArtists')[1].length, 2);
    assert.equal(h.calls.find(c => c[0] === 'setTastePlaylistStatus')[1], 'idle');
    assert.equal(h.replies[0].data.success, true);
});
test('denied permission never scans and scanner failure retains granted response', async () => {
    const denied = harness({ granted: false }); denied.send('permission'); await denied.flush();
    assert.equal(denied.calls.some(c => c[0] === 'scan'), false);
    assert.equal(denied.replies[0].data.granted, false);
    const failed = harness({ scanFails: true }); failed.send('permission'); await failed.flush();
    assert.equal(failed.replies[0].data.granted, true);
    assert.equal(failed.replies[1].data.error, '');
});
test('accepted finish survives route unmount and duplicate requests while building', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const h = harness({ generation: () => pending });
    h.send('finish', profile(3)); h.send('finish', profile(3)); h.unmount(); release({ tracks: [] }); await h.flush();
    assert.equal(h.calls.filter(c => c[0] === 'build').length, 1);
    assert.equal(h.calls.filter(c => c[0] === 'completeOnboarding').length, 1);
    assert.equal(h.replies.length, 0);
});
test('unmount after reply but before native acknowledgement still completes', async () => {
    const h = harness(); h.send('finish', profile(0)); await h.flush(); h.unmount();
    assert.equal(h.calls.filter(c => c[0] === 'completeOnboarding').length, 1);
});
