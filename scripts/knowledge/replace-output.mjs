import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  openSync,
  writeFileSync,
} from "node:fs";

/**
 * Overwrite `file` with `content` and return the mtime the file had just
 * before, for the compilers' "the previous knowledge file was stale" note.
 *
 * The mtime, the truncate and the write all go through one descriptor, so
 * they are guaranteed to be about the same file: a stat by name followed by a
 * write by name could each resolve the path to something different. A file
 * that did not exist is created and reports its creation time, which no
 * source file can be newer than, so the note stays quiet exactly as it did
 * when a missing file was reported as null.
 */
export function replaceOutput(file, content) {
  const fd = openSync(file, constants.O_RDWR | constants.O_CREAT);
  try {
    const { mtimeMs } = fstatSync(fd);
    ftruncateSync(fd, 0);
    writeFileSync(fd, content, "utf8");
    return mtimeMs;
  } finally {
    closeSync(fd);
  }
}
