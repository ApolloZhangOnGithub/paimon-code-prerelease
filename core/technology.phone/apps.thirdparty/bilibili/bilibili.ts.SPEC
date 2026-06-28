source: bilibili.ts @ e7a533de

# Bilibili — 视频内容提取

## 功能
B站视频字幕/语音/元数据提取。三条路径：
1. AI 字幕：弹幕 API (`x/v2/dm/view`)，免登录
2. Whisper：faster-whisper 语音转文字（6核并行）
3. OCR 硬字幕：Vision/PaddleOCR 识别画面内嵌字幕

## 操作
- `subs <bvid>` — 提取 AI 字幕
- `whisper <url>` — 语音转文字
- `hardsub <url>` — OCR 硬字幕
- `info <bvid>` — 视频元数据

## 数据
底层 Python 脚本位于 `~/Desktop/OSC 开源项目/monorepo base/`

## 依赖
- Python: requests, faster-whisper, opencv-python
- macOS: pyobjc-framework-Vision, ffmpeg
