// pi-coding-master 扩展入口（pi 加载 ~/.pi/agent/extensions/pi-coding-master/index.ts）。
// 真正的装配在 kernel。这里只 re-export —— kernel 文件随便移,只改 package.json 的 "#kernel" 一行。
export { default } from "#kernel";
