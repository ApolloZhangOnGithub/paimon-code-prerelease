// listen-doubao_client.test.ts — protobuf 编解码回归测试
// 期望值来自原 python pb2 生成物的逐字节输出(python_protogen 移除前对拍固化)
import { test, expect } from "bun:test";
import { encodeTranslateRequest, decodeTranslateResponse, EV } from "./listen-doubao_client.ts";

const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const SID = "test-session-0001";

test("StartSession 编码与 python pb2 逐字节一致", () => {
  expect(hex(encodeTranslateRequest({ sessionId: SID, event: EV.StartSession, srcLang: "zhen", tgtLang: "zhen" })))
    .toBe("0a133211746573742d73657373696f6e2d3030303110641a100a0670692d656172120670692d656172220c220377617638807d4010480132110a0373327412047a68656e1a047a68656e");
});

test("TaskRequest(带 512B pcm) 编码一致", () => {
  const pcm = new Uint8Array(512); for (let i = 0; i < 512; i++) pcm[i] = i % 256;
  expect(hex(encodeTranslateRequest({ sessionId: SID, event: EV.TaskRequest, srcLang: "zhen", tgtLang: "zhen", pcm })))
    .toBe("0a133211746573742d73657373696f6e2d3030303110c8011a100a0670692d656172120670692d656172228f04220377617638807d40104801728004000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9fafbfcfdfeff32110a0373327412047a68656e1a047a68656e");
});

test("FinishSession 编码一致", () => {
  expect(hex(encodeTranslateRequest({ sessionId: SID, event: EV.FinishSession, srcLang: "zhen", tgtLang: "zhen" })))
    .toBe("0a133211746573742d73657373696f6e2d3030303110661a100a0670692d656172120670692d656172220c220377617638807d4010480132110a0373327412047a68656e1a047a68656e");
});

test("TranslateResponse 解码 (event/text/StatusCode/Message)", () => {
  const d = decodeTranslateResponse(new Uint8Array(Buffer.from("0a091880dac40922024f4b108c05220fe4bda0e5a5bdefbc8ce4b896e7958c", "hex")));
  expect(d.event).toBe(652);
  expect(d.text).toBe("你好，世界");
  expect(d.statusCode).toBe(20000000);
  expect(d.message).toBe("OK");
});
