source: speak_recorder.py @ 9d2e281a

豆包TTS语音合成脚本：接收文本→调用豆包语音合成2.0 API→保存MP3→写静音标记→播放→清标记。鉴权格式: Bearer;{access_token} + app.token={access_token}。