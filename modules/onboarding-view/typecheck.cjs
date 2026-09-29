const ts = require('typescript');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
// Root includes the separate Vite web app with unresolved @staysound aliases.
// Check all other roots, including the RN fallback, with the unchanged compiler options.
const files = parsed.fileNames.filter(file => !file.startsWith(path.join(root, 'web') + path.sep));
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(ts.createProgram(files, { ...parsed.options, noEmit: true }))];
console.log(`Mobile typecheck: ${files.length} files, ${diagnostics.length} errors`);
if (diagnostics.length) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n',
}));
process.exitCode = diagnostics.length ? 1 : 0;
