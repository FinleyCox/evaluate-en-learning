const chains = new Map();

/**
 * セッション単位で処理を直列化する。
 *
 * ターンの追加や採点は「読み込む → 変える → 書き出す」で、途中に await が入る。
 * 同じセッションへの要求が重なると、後から書いた側が前の変更を消してしまうため、
 * 同じ id の処理は前のものが終わるまで待たせる。
 */
export function withSessionLock(id, fn) {
  const prev = chains.get(id) || Promise.resolve();
  const run = prev.then(fn);
  // 前の処理が失敗しても鎖を切らない（次の要求が永久に待たされないように）
  const tail = run.then(
    () => {},
    () => {}
  );
  chains.set(id, tail);
  // 待ちがなくなったら Map から消す（セッションが増えても残り続けないように）
  tail.then(() => {
    if (chains.get(id) === tail) chains.delete(id);
  });
  return run;
}

/** テスト用。待ち行列が残っているセッション数。 */
export function pendingLocks() {
  return chains.size;
}
