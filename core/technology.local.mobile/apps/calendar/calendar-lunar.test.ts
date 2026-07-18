// calendar-lunar.test.ts — 农历换算与节假日回归测试
// 覆盖 2026-07-16 修复的时区 off-by-one bug(toISOString → fmtLocal)
import { test, expect } from "bun:test";
import { lunarDate, solarToLunar, getHolidaysForDate, getHolidays } from "./calendar.ts";

test("春节公历日期(lunarDate 正月初一 = LUNAR_DATA cny)", () => {
  expect(lunarDate(2024, 1, 1)).toBe("2024-02-10");
  expect(lunarDate(2025, 1, 1)).toBe("2025-01-29");
  expect(lunarDate(2026, 1, 1)).toBe("2026-02-17");
  expect(lunarDate(2027, 1, 1)).toBe("2027-02-06");
});

test("solarToLunar 已知日期", () => {
  const d = solarToLunar("2026-07-16")!;
  expect(d.lunarMonth).toBe(6);
  expect(d.lunarDay).toBe(3);
  expect(d.isLeap).toBe(false);
  expect(d.monthName).toBe("六");
  expect(d.dayName).toBe("初三");
});

test("闰月正确处理(2025 闰六月)", () => {
  const d = solarToLunar("2025-07-26")!;
  expect(d.isLeap).toBe(true);
  expect(d.monthName).toBe("闰六");
  expect(d.dayName).toBe("初二");
});

test("春节系列日期不再偏移一天", () => {
  expect(getHolidaysForDate("CN", "2026-02-16").map(h => h.name)).toContain("除夕");
  expect(getHolidaysForDate("CN", "2026-02-17").map(h => h.name)).toContain("春节");
  expect(getHolidaysForDate("CN", "2026-02-19").map(h => h.name)).toContain("春节·初三");
});

test("Good Friday = 复活节前两天(本地日期,无时区偏移)", () => {
  expect(getHolidays("US", 2026).find(h => h.name === "Good Friday")?.date).toBe("2026-04-03");
});

test("端午/中秋 阴历锚定", () => {
  expect(getHolidays("CN", 2026).find(h => h.name === "端午节")?.date).toBe("2026-06-19");
  expect(getHolidays("CN", 2026).find(h => h.name === "中秋节")?.date).toBe("2026-09-25");
});
