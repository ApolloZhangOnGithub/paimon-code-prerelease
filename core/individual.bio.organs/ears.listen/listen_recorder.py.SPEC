source: listen_recorder.py @ 4ae17c83

ear_recorder.py — 独立麦克风录制 + 豆包实时语音识别
设计目标：不依赖 Local_24h_Note，直接调火山引擎豆包同声传译 API，
产出 JSONL 格式转录结果供 ear.ts 消费。

用户原话："我要的就是豆包啊" "当然是麦克风啊，说话你懂吗"
