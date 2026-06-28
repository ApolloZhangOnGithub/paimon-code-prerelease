let _lastDir = null;
export function markLs(dir) { _lastDir = dir; }
export function isLsed(dir) { return _lastDir === dir; }
export function clearLs() { _lastDir = null; }
