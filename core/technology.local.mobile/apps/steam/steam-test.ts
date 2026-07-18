// steam/test.ts — CLI 测试入口，直接玩
// 仅当直接执行时才启动，被 import 时不运行（防止 mobile 内核自动加载时抢占 stdin）
import { G2048 } from "./steam-005_2048.ts";
import { GomokuGame } from "./steam-006_gomoku.ts";
import { MinesweeperGame } from "./steam-007_minesweeper.ts";
import { WerewolfGame } from "./steam-004_werewolf.ts";
import { ChessGame } from "./steam-002_chess.ts";
import { SnakeGame } from "./steam-003_greedy_snake.ts";
import { SpyGame } from "./steam-001_who_is_spy.ts";
import { createInterface } from "node:readline";

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  function ask(q: string): Promise<string> { return new Promise(r => rl.question(q, r)); }
  console.log("═══ Steam CLI Tester ═══");
  console.log("1. 2048  2. 五子棋  3. 扫雷  4. 国际象棋  5. 贪吃蛇");
  const choice = await ask("选游戏: ");

  if (choice === "1") {
    const g = new G2048();
    while (!g.over) {
      console.log(g.screen());
      const dir = await ask("方向 (wasd/q退出): ");
      if (dir === "q") break;
      const map: Record<string, 'u'|'d'|'l'|'r'> = { w: 'u', s: 'd', a: 'l', d: 'r' };
      if (map[dir]) g.move(map[dir]);
    }
    console.log(g.screen());
  } else if (choice === "2") {
    const g = new GomokuGame("medium");
    while (!g.over) {
      console.log(g.screen());
      const input = await ask("坐标 (行 列, q退出): ");
      if (input === "q") break;
      const m = input.match(/^(\d{1,2})\s+(\d{1,2})$/);
      if (m) {
        const r = g.place(parseInt(m[1]), parseInt(m[2]));
        if (!r.ok) console.log(r.error);
        else if (r.ai) console.log("AI:", r.ai);
      }
    }
    console.log(g.screen());
  } else if (choice === "3") {
    const g = new MinesweeperGame(9, 9, 10);
    while (!g.over) {
      console.log(g.screen());
      const input = await ask("操作 (3 4翻开, f 3 4插旗, q退出): ");
      if (input === "q") break;
      const rm = input.match(/^(\d{1,2})\s+(\d{1,2})$/);
      const fm = input.match(/^f\s+(\d{1,2})\s+(\d{1,2})$/i);
      if (rm) {
        const r = g.action(parseInt(rm[1]), parseInt(rm[2]), false);
        if (!r.ok) console.log(r.error);
      } else if (fm) {
        const r = g.action(parseInt(fm[1]), parseInt(fm[2]), true);
        if (!r.ok) console.log(r.error);
      }
    }
    console.log(g.screen());
  } else if (choice === "4") {
    const g = new ChessGame("medium");
    while (!g.s.over) {
      console.log(g.screen());
      const input = await ask("走法 (e2e4, 认输, q退出): ");
      if (input === "q") break;
      if (input === "认输") { g.resign(); break; }
      const r = g.move(input);
      if (!r.ok) console.log(r.error);
      else if (r.ai) console.log("AI:", r.ai);
    }
    console.log(g.screen());
  } else if (choice === "5") {
    const g = new SnakeGame();
    while (!g.over) {
      console.log(g.screen());
      const dir = await ask("方向 (wasd/q退出): ");
      if (dir === "q") break;
      const map: Record<string, 'u'|'d'|'l'|'r'> = { w: 'u', s: 'd', a: 'l', d: 'r' };
      if (map[dir]) g.input(map[dir]);
    }
    console.log(g.screen());
  }
  rl.close();
}

// 仅直接运行时启动，被 import 时不抢 stdin
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("test.ts")) {
  main();
}
