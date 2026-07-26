/**
 * Teaches mocha the "@/..." path alias that next/tsconfig already understand.
 *
 * Without this the spec suite cannot run at all: every spec imports a module
 * that imports "@/prisma/client", node has no idea what that means, and the run
 * dies during file loading — before a single test is collected. It fails the
 * same way whether the code is right or wrong, which is why a broken
 * isAddressed could ship past a file whose whole job was to catch it.
 */
const path = require('path');
const Module = require('module');

const SRC = path.join(__dirname, '..', 'src');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = path.join(SRC, request.slice(2));
  return resolve.call(this, request, ...rest);
};
