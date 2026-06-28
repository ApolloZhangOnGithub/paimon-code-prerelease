source: speak.ts @ c30bbeef

mouth.speak — TTS 语音输出器官。使用豆包 TTS (vivi 2.0) WebSocket 流式合成。支持 /mouth 手动朗读和 /mouth on|off 自动朗读回复。mouth 说话时通过 /tmp/pi_mouth_speaking 标记通知 ear 暂停监听（防回声）。
