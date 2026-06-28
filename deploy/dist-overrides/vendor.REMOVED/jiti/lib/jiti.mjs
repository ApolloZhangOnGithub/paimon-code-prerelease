// jiti DISABLED by NORM-020 — any import() goes through native Node, not jiti
export function createJiti() { throw new Error("jiti disabled by NORM-020. Use native Node import() instead."); }
export default createJiti;
