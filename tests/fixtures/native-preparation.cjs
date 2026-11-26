const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const goDownload = process.env.TUGBOAT_TEST_GO_DOWNLOAD;
if (goDownload) {
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  Object.defineProperty(process, 'arch', { value: 'arm64' });
  globalThis.fetch = async () => { throw new Error('synthetic Go download failure'); };
}

childProcess.execFileSync = (binary, argumentsList) => {
  fs.appendFileSync(process.env.TUGBOAT_NATIVE_COMMANDS, JSON.stringify({ binary, argumentsList }) + '\n');
  const write = (file, contents) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  if (binary === '/usr/bin/curl' && goDownload) {
    write(argumentsList[argumentsList.indexOf('-o') + 1], goDownload === 'valid' ? 'synthetic native archive' : 'corrupt archive');
  }
  if (binary === '/usr/bin/tar') {
    if (argumentsList[0] === '-tzf') return 'fixture\n';
    const archive = path.basename(argumentsList[argumentsList.indexOf('-xf') + 1] ?? '');
    const workspace = process.cwd();
    if (archive === 'go.tar.gz') write(path.join(workspace, '.build/hull-compat/go/bin/go'), 'fixture Go');
    if (archive === 'hull.tar.gz') {
      for (const directory of ['cmd/hull', 'internal/netgw']) {
        fs.mkdirSync(path.join(workspace, '.build/hull-compat/hull-fixture-commit', directory), { recursive: true });
      }
    }
    if (argumentsList.includes('-xzf')) fs.mkdirSync(path.join(workspace, '.build/brig-compat/brig-fixture-commit/internal/runtime'), { recursive: true });
  }
  if (binary === process.execPath) write(path.join(process.cwd(), '.build/hull-compat/go/bin/go'), 'fixture Go');
  if (argumentsList[0] === 'test' && process.env.TUGBOAT_FAIL_NATIVE_TEST === 'true') throw new Error('synthetic Go test failure');
  if (argumentsList[0] === 'build') write(argumentsList[argumentsList.indexOf('-o') + 1], 'fixture executable');
  if (argumentsList[0] === '--json') return JSON.stringify({ data: { version: 'v0.1.0', commit: 'fixture-commit', modified: true } });
  if (binary === '/usr/bin/lipo') return 'arm64\n';
  if (binary === '/usr/bin/vtool') return 'minos 15.0\n';
  if (binary === '/usr/bin/otool') return 'fixture:\n\t/usr/lib/libSystem.B.dylib (fixture)\n';
  if (binary === '/usr/bin/codesign' && argumentsList[0] === '-d') return '<key>com.apple.security.hypervisor</key><true/><key>com.apple.security.virtualization</key><true/>';
  return Buffer.alloc(0);
};
require('node:module').syncBuiltinESMExports();
