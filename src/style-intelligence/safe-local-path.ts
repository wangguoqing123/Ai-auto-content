import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

const allowedSystemSymlinkComponents = new Set(['/tmp', '/var', '/etc']);
const allowedSourceExtensions = new Set(['.md', '.markdown', '.txt', '.jsonl']);

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function nearestExistingAncestor(value: string): Promise<string> {
  let current = path.resolve(value);
  while (true) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
}

export async function assertNoSymlinkComponents(value: string, allowMissingTail = false): Promise<void> {
  const absolute = path.resolve(value);
  const root = path.parse(absolute).root;
  const components = absolute.slice(root.length).split(path.sep).filter(Boolean);
  let current = root;
  let missing = false;
  for (const component of components) {
    current = path.join(current, component);
    if (missing) continue;
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() && !allowedSystemSymlinkComponents.has(current)) throw new Error(`symlink_component_not_allowed:${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && allowMissingTail) {
        missing = true;
        continue;
      }
      throw error;
    }
  }
}

export async function assertResolvedPathOutsideRepository(resolvedPath: string, repositoryRoot = process.cwd()): Promise<void> {
  const canonicalRepository = await realpath(repositoryRoot);
  const canonicalCandidate = path.resolve(resolvedPath);
  if (isInside(canonicalRepository, canonicalCandidate)) throw new Error('style_path_must_be_outside_repository');
  const gitPath = path.join(canonicalRepository, '.git');
  if (isInside(gitPath, canonicalCandidate)) throw new Error('style_path_must_be_outside_git_metadata');
}

export async function resolveVerifiedCorpusRoot(corpusRoot: string, repositoryRoot = process.cwd()): Promise<string> {
  const requested = path.resolve(corpusRoot);
  try {
    const existing = await lstat(requested);
    if (existing.isSymbolicLink()) throw new Error('corpus_root_symlink_not_allowed');
    if (!existing.isDirectory()) throw new Error('corpus_root_must_be_directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await assertNoSymlinkComponents(path.dirname(requested), true);
  const ancestor = await nearestExistingAncestor(path.dirname(requested));
  const canonicalAncestor = await realpath(ancestor);
  const prospective = path.resolve(canonicalAncestor, path.relative(ancestor, requested));
  await assertResolvedPathOutsideRepository(prospective, repositoryRoot);
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const created = await lstat(requested);
  if (created.isSymbolicLink()) throw new Error('corpus_root_symlink_not_allowed');
  if (!created.isDirectory()) throw new Error('corpus_root_must_be_directory');
  await assertNoSymlinkComponents(requested);
  const resolved = await realpath(requested);
  await assertResolvedPathOutsideRepository(resolved, repositoryRoot);
  await chmod(resolved, 0o700);
  return resolved;
}

export async function resolveVerifiedSourceFile(sourcePath: string, repositoryRoot = process.cwd()): Promise<string> {
  const requested = path.resolve(sourcePath);
  const extension = path.extname(requested).toLocaleLowerCase();
  if (!allowedSourceExtensions.has(extension)) throw new Error('style_import_supports_markdown_text_or_jsonl_only');
  const info = await lstat(requested);
  if (info.isSymbolicLink()) throw new Error('style_source_symlink_not_allowed');
  if (!info.isFile()) throw new Error('style_source_must_be_regular_file');
  await assertNoSymlinkComponents(requested);
  const resolved = await realpath(requested);
  await assertResolvedPathOutsideRepository(resolved, repositoryRoot);
  const resolvedInfo = await stat(resolved);
  if (!resolvedInfo.isFile()) throw new Error('style_source_must_be_regular_file');
  return resolved;
}

export async function readVerifiedSourceFile(sourcePath: string, repositoryRoot = process.cwd()): Promise<{ path: string; content: string }> {
  const resolved = await resolveVerifiedSourceFile(sourcePath, repositoryRoot);
  const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('style_source_must_be_regular_file');
    return { path: resolved, content: await handle.readFile('utf8') };
  } finally {
    await handle.close();
  }
}

export async function assertRegularPrivateFile(filename: string, corpusRoot: string): Promise<string> {
  const requested = path.resolve(filename);
  const root = await realpath(corpusRoot);
  if (!isInside(root, requested)) throw new Error('private_file_outside_corpus');
  await assertNoSymlinkComponents(requested);
  const info = await lstat(requested);
  if (info.isSymbolicLink()) throw new Error('private_file_symlink_not_allowed');
  if (!info.isFile()) throw new Error('private_file_must_be_regular');
  if ((info.mode & 0o777) !== 0o600) throw new Error('private_file_insecure_permissions');
  const resolved = await realpath(requested);
  if (!isInside(root, resolved)) throw new Error('private_file_outside_corpus');
  return resolved;
}

export async function readPrivateCorpusFile(filename: string, corpusRoot: string): Promise<string> {
  const resolved = await assertRegularPrivateFile(filename, corpusRoot);
  const handle = await open(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600) throw new Error('private_file_insecure');
    return await handle.readFile('utf8');
  } finally {
    await handle.close();
  }
}

async function assertDirectoryNoSymlink(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink()) throw new Error(`corpus_directory_symlink_not_allowed:${directory}`);
  if (!info.isDirectory()) throw new Error(`corpus_directory_required:${directory}`);
}

export async function assertCorpusTreeSecure(corpusRoot: string): Promise<void> {
  const root = await realpath(corpusRoot);
  await assertNoSymlinkComponents(root);
  const walk = async (directory: string): Promise<void> => {
    await assertDirectoryNoSymlink(directory);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name);
      const info = await lstat(child);
      if (info.isSymbolicLink()) throw new Error(`corpus_symlink_not_allowed:${child}`);
      if (info.isDirectory()) await walk(child);
      else if (info.isFile()) await assertRegularPrivateFile(child, root);
      else throw new Error(`corpus_special_file_not_allowed:${child}`);
    }
  };
  await walk(root);
}

export async function secureAtomicWrite(filename: string, content: string): Promise<void> {
  const target = path.resolve(filename);
  const directory = path.dirname(target);
  await assertNoSymlinkComponents(directory);
  await assertDirectoryNoSymlink(directory);
  try {
    const existing = await lstat(target);
    if (existing.isSymbolicLink()) throw new Error('secure_write_target_symlink_not_allowed');
    if (!existing.isFile()) throw new Error('secure_write_target_must_be_regular');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW, 0o600);
    await handle.writeFile(content, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      const existing = await lstat(target);
      if (existing.isSymbolicLink()) throw new Error('secure_write_target_symlink_not_allowed');
      if (!existing.isFile()) throw new Error('secure_write_target_must_be_regular');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await rename(temporary, target);
    const written = await lstat(target);
    if (written.isSymbolicLink() || !written.isFile()) throw new Error('secure_write_result_invalid');
    if ((written.mode & 0o777) !== 0o600) await chmod(target, 0o600);
    try {
      const directoryHandle = await open(directory, fsConstants.O_RDONLY);
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch (error) {
      if (!['EINVAL', 'ENOTSUP', 'EISDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  } catch (error) {
    if (handle !== undefined) await handle.close();
    try { await unlink(temporary); } catch (cleanupError) { if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError; }
    throw error;
  }
}
