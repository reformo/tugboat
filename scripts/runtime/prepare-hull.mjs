import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const pin = JSON.parse(fs.readFileSync(path.join(root, 'config/hull-compat.json')));
const work = path.join(root, '.build/hull-compat');
const source = path.join(work, 'hull-' + pin.commit);
const patch = path.join(root, 'resources/runtime/hull-spaces.patch');
const diskToolsPatch = path.join(root, 'resources/runtime/hull-disk-tools.patch');
const rootRestorePatch = path.join(root, 'resources/runtime/hull-rootfs-restore.patch');
const activityPatch = path.join(root, 'resources/runtime/hull-network-activity.patch');
const activity = path.join(root, 'resources/network-activity');
const activityFiles = ['activity.go', 'actors.go', 'incoming.go'];
const probeFiles = ['guest/main.go', 'guest/probes.go'];
const probe = path.join(work, 'bin/network-attribution');
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const noSign = process.argv.includes('--no-sign');
const activitySources = Object.fromEntries([...activityFiles, ...probeFiles].map(file => [file, hash(path.join(activity, file))]));
const identity = JSON.stringify({ ...pin, activityPatch: hash(activityPatch), activitySources, patch: hash(patch), diskToolsPatch: hash(diskToolsPatch), rootRestorePatch: hash(rootRestorePatch), signing: noSign ? 'none' : 'ad-hoc' });
const binary = path.join(work, 'bin/hull');
const go = path.join(work, 'go/bin/go');
const buildFile = path.join(work, 'bin/build.json');
const marker = path.join(work, 'prepared.json');
const test = process.argv.includes('--test');
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This build requires an Apple silicon Mac.');
function savedBuild() {
  if (!fs.existsSync(buildFile)) return null;
  try { return JSON.parse(fs.readFileSync(buildFile, 'utf8')); }
  catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
const build = savedBuild();
const cached = fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === identity
  && fs.existsSync(go) && fs.existsSync(binary) && build?.binarySha256 === hash(binary)
  && fs.existsSync(probe) && build.networkAttributionSha256 === hash(probe)
  && build.patchSha256 === hash(patch) && build.diskToolsPatchSha256 === hash(diskToolsPatch)
  && build.rootRestorePatchSha256 === hash(rootRestorePatch);
if (cached && !test) process.exit(0);
fs.mkdirSync(path.join(work, 'downloads'), { recursive: true });
function archive(url, checksum, name) {
  const file = path.join(work, 'downloads', name);
  if (!fs.existsSync(file) || hash(file) !== checksum) {
    const temporary = file + '.partial';
    console.log('Downloading ' + name + ' for Hull preparation.');
    try {
      execFileSync('/usr/bin/curl', ['-fsSL', '--retry', '2', '--connect-timeout', '15', '--max-time', '180', url, '-o', temporary], { timeout: 600_000, stdio: 'inherit' });
      if (hash(temporary) !== checksum) throw new Error('Archive checksum mismatch: ' + name);
      fs.renameSync(temporary, file);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  if (name === 'go.tar.gz') fs.rmSync(path.join(work, 'go'), { recursive: true, force: true });
  execFileSync('/usr/bin/tar', ['-xf', file, '-C', work]);
}
if (!cached) {
  fs.rmSync(source, { recursive: true, force: true });
  archive(pin.source.url, pin.source.sha256, 'hull.tar.gz');
  archive(pin.go.url, pin.go.sha256, 'go.tar.gz');
  execFileSync('/usr/bin/patch', ['--batch', '-p1', '-i', patch], { cwd: source, stdio: 'inherit' });
  execFileSync('/usr/bin/patch', ['--batch', '-p1', '-i', diskToolsPatch], { cwd: source, stdio: 'inherit' });
  execFileSync('/usr/bin/patch', ['--batch', '-p1', '-i', rootRestorePatch], { cwd: source, stdio: 'inherit' });
  execFileSync('/usr/bin/patch', ['--batch', '-p1', '-i', activityPatch], { cwd: source, stdio: 'inherit' });
  for (const file of activityFiles) fs.copyFileSync(path.join(activity, file), path.join(source, 'internal/netgw', file));
  fs.mkdirSync(path.join(source, 'cmd/network-attribution'), { recursive: true });
  for (const file of probeFiles) fs.copyFileSync(path.join(activity, file), path.join(source, 'cmd/network-attribution', path.basename(file)));
}
fs.copyFileSync(path.join(root, 'tests/native/hull_spaces_test.go'), path.join(source, 'cmd/hull/desktop_spaces_test.go'));
fs.copyFileSync(path.join(root, 'tests/native/hull_disk_tools_test.go'), path.join(source, 'cmd/hull/desktop_disk_tools_test.go'));
fs.copyFileSync(path.join(root, 'tests/native/hull_rootfs_restore_test.go'), path.join(source, 'cmd/hull/desktop_rootfs_restore_test.go'));
const environment = { ...process.env, GOTOOLCHAIN: 'local', GOCACHE: path.join(work, 'go-cache'), GOPATH: path.join(work, 'go-path'), CGO_ENABLED: '0', GOOS: 'darwin', GOARCH: 'arm64' };
const options = { cwd: source, env: environment, stdio: 'inherit' };
if (test) {
  fs.copyFileSync(path.join(root, 'tests/native/hull_network_activity_test.go'), path.join(source, 'internal/netgw/desktop_network_activity_test.go'));
  execFileSync(go, ['test', '-mod=readonly', './internal/netgw', '-run', '^TestDesktopNetworkActivity', '-count=1'], options);
  execFileSync(go, ['test', '-mod=readonly', './cmd/hull', '-run', 'Test(Desktop|ParseShares|SplitShare)', '-count=1', '-v'], options);
  process.exit(0);
}
if (!cached) {
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  const info = 'github.com/brig-sh/hull/internal/buildinfo';
  const flags = ['-s', '-w', '-X', info + '.gitCommit=' + pin.commit, '-X', info + '.gitCommitTime=' + pin.commitTime,
    '-X', info + '.gitDescribe=' + pin.version + '-0-g' + pin.commit.slice(0, 7), '-X', info + '.gitModified=true'].join(' ');
  execFileSync(go, ['build', '-mod=readonly', '-buildvcs=false', '-trimpath', '-ldflags', flags, '-o', binary, './cmd/hull'], options);
  execFileSync(go, ['build', '-mod=readonly', '-buildvcs=false', '-trimpath', '-ldflags', '-s -w', '-o', probe, './cmd/network-attribution'], {
    ...options, env: { ...environment, GOOS: 'linux' },
  });
  if (!noSign) execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', binary], { stdio: 'inherit' });
  fs.writeFileSync(buildFile, JSON.stringify({ ...pin, modified: true, networkActivityPatchSha256: hash(activityPatch), networkAttributionSha256: hash(probe), patchSha256: hash(patch), diskToolsPatchSha256: hash(diskToolsPatch), rootRestorePatchSha256: hash(rootRestorePatch), binarySha256: hash(binary) }, null, 2) + '\n');
  fs.writeFileSync(marker, identity);
  console.log('Prepared hull ' + pin.version + ' with ' + pin.variant + '.');
}
