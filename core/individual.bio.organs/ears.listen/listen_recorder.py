#!/usr/bin/env python3
"""ear_recorder.py — 麦克风 → 豆包 ASR → ear_output.jsonl
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
不依赖 Local_24h_Note 的任何代码或数据。直接通过 PyAudio 采集
麦克风，调用豆包同传 API，转录结果写入 ear_output.jsonl。

用法：
  python3 ear_recorder.py <output_jsonl_path>
    output_jsonl_path: ~/.pi/memory/<id>/.data/ear_output.jsonl

凭证：
  DOUBAO_APP_KEY / DOUBAO_ACCESS_KEY 环境变量
  或 ./config.json（ear 自己的配置文件）
"""

import json
import os
import sys
import threading
import time
import queue
import uuid
from datetime import datetime

import numpy as np
import pyaudio
import websocket

# protobuf stubs（豆包 API）
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from python_protogen.common.events_pb2 import Type as EventType
from python_protogen.products.understanding.ast.ast_service_pb2 import (
    TranslateRequest, TranslateResponse)

# ── 常量 ──────────────────────────────────────────────────────
WS_URL      = 'wss://openspeech.bytedance.com/api/v4/ast/v2/translate'
RESOURCE_ID = 'volc.service_type.10053'
SAMPLE_RATE = 16000
CHUNK_MS    = 100
CHUNK_SIZE  = int(SAMPLE_RATE * CHUNK_MS / 1000)  # 1600 samples

# 豆包事件码
EVENT_ASR_DELTA  = 651
EVENT_ASR_DONE   = 652
EVENT_SESSION_FAILED = 153

# ── 配置加载 ──────────────────────────────────────────────────
def load_config():
    cfg = {
        'doubao_app_key': '',
        'doubao_access_key': '',
        'src_lang': 'zhen',
        'tgt_lang': 'zhen',
        'silence_rms': 80,
        'silence_hangover_s': 1.5,
        'idle_close_s': 3.0,
    }
    # 1. 环境变量
    for key in ('doubao_app_key', 'doubao_access_key'):
        env_key = key.upper()
        val = os.environ.get(env_key, '')
        if val:
            cfg[key] = val
    # 2. ear 自己的 config.json
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    if os.path.exists(cfg_path):
        try:
            with open(cfg_path, 'r', encoding='utf-8') as f:
                cfg.update(json.load(f))
        except Exception:
            pass
    return cfg


# ── 豆包同传客户端 ────────────────────────────────────────────
class DoubaoTranscriber:
    """惰性连接 + 空闲断开 + 断线重连。回调 on_result(rec) 收到：
       {'time': str, 'text': str, 'translation': str, 'is_final': bool}"""

    def __init__(self, app_key: str, access_key: str,
                 src_lang: str = 'zhen', tgt_lang: str = 'zhen',
                 idle_close_s: float = 3.0):
        self.app_key = app_key
        self.access_key = access_key
        self.src_lang = src_lang
        self.tgt_lang = tgt_lang
        self.idle_close_s = idle_close_s
        self._q = queue.Queue(maxsize=600)
        self._on_result = None
        self._running = threading.Event()
        self._active = False
        self._lock = threading.Lock()
        self._thread = None

    def start(self, on_result):
        self._on_result = on_result
        self._running.set()
        self._thread = threading.Thread(target=self._worker, daemon=True)
        self._thread.start()

    def feed(self, pcm: bytes):
        try:
            self._q.put_nowait(pcm)
        except queue.Full:
            pass

    def stop(self):
        self._running.clear()
        if self._thread:
            self._thread.join(timeout=5)

    @property
    def active(self):
        with self._lock:
            return self._active

    def _make_msg(self, event, session_id, pcm=b''):
        req = TranslateRequest()
        req.request_meta.SessionID = session_id
        req.event = event
        req.user.uid = 'pi-ear'
        req.user.did = 'pi-ear'
        req.source_audio.format = 'wav'
        req.source_audio.rate = SAMPLE_RATE
        req.source_audio.bits = 16
        req.source_audio.channel = 1
        req.request.mode = 's2t'
        req.request.source_language = self.src_lang
        req.request.target_language = self.tgt_lang
        if pcm:
            req.source_audio.binary_data = pcm
        return req.SerializeToString()

    def _handle_response(self, resp):
        if resp.event == EVENT_SESSION_FAILED:
            print(f'[ear] 豆包会话失败: code={resp.response_meta.StatusCode}')
            return True  # session dead
        text = (resp.text or '').strip()
        if resp.event == EVENT_ASR_DONE and text:
            self._on_result({
                'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3],
                'text': text,
                'translation': '',
                'is_final': True,
            })
        elif resp.event == EVENT_ASR_DELTA and text:
            self._on_result({
                'time': datetime.now().strftime('%Y-%m-%d %H:%M:%S.%f')[:-3],
                'text': text,
                'translation': '',
                'is_final': False,
            })
        return False

    def _worker(self):
        reconnect_delay = 2
        MAX_DELAY = 60
        SILENCE_100MS = b'\x00' * 3200

        while self._running.is_set():
            try:
                first_pcm = self._q.get(timeout=0.5)
            except queue.Empty:
                continue

            ws = None
            session_id = str(uuid.uuid4())
            session_dead = False
            try:
                ws = websocket.create_connection(
                    WS_URL,
                    header={
                        'X-Api-App-Key': self.app_key,
                        'X-Api-Access-Key': self.access_key,
                        'X-Api-Resource-Id': RESOURCE_ID,
                        'X-Api-Connect-Id': str(uuid.uuid4()),
                    }, timeout=10)

                ws.send_binary(self._make_msg(EventType.StartSession, session_id))
                ws.settimeout(15)
                resp = TranslateResponse()
                resp.ParseFromString(ws.recv())
                if resp.event != EventType.SessionStarted:
                    raise ConnectionError(
                        f'启动失败: event={resp.event} code={resp.response_meta.StatusCode}')

                with self._lock:
                    self._active = True
                reconnect_delay = 2
                print(f'[ear] 豆包已连接')

                ws.settimeout(0.02)
                ws.send_binary(self._make_msg(EventType.TaskRequest, session_id, first_pcm))
                audio_clock = time.monotonic()
                last_real_t = time.monotonic()

                while self._running.is_set():
                    try:
                        data = ws.recv()
                        if data:
                            r = TranslateResponse()
                            r.ParseFromString(data)
                            if self._handle_response(r):
                                session_dead = True
                                break
                        else:
                            break
                    except websocket.WebSocketTimeoutException:
                        pass
                    except websocket.WebSocketConnectionClosedException:
                        # WS 掉了——退出内层循环，外层会重连
                        break
                    except OSError:
                        # macOS 偶尔丢音频设备——不致命，继续
                        continue

                    now = time.monotonic()
                    if now - last_real_t > self.idle_close_s:
                        ws.send_binary(self._make_msg(EventType.FinishSession, session_id))
                        ws.settimeout(1)
                        try:
                            drain_until = time.monotonic() + 3
                            while time.monotonic() < drain_until:
                                r = TranslateResponse()
                                r.ParseFromString(ws.recv())
                                self._handle_response(r)
                        except Exception:
                            pass
                        break

                    if now - audio_clock > 2.0:
                        audio_clock = now - 2.0
                    while audio_clock <= now and self._running.is_set():
                        try:
                            pcm = self._q.get_nowait()
                            last_real_t = now
                        except queue.Empty:
                            pcm = SILENCE_100MS
                        ws.send_binary(self._make_msg(EventType.TaskRequest, session_id, pcm))
                        audio_clock += len(pcm) / 2.0 / SAMPLE_RATE

            except websocket.WebSocketConnectionClosedException:
                # 豆包 WS 掉了——正常，静默重连
                reconnect_delay = min(reconnect_delay * 2, MAX_DELAY)
            except Exception as e:
                # 真正的异常（鉴权/网络/协议）才打印
                msg = str(e)[:120]
                if 'Connection' not in msg and 'timeout' not in msg.lower():
                    print(f'[ear] 豆包异常: {msg}')
                reconnect_delay = min(reconnect_delay * 2, MAX_DELAY)
            finally:
                with self._lock:
                    self._active = False
                if ws:
                    try:
                        if not session_dead:
                            ws.send_binary(self._make_msg(EventType.FinishSession, session_id))
                    except Exception:
                        pass
                    try:
                        ws.close()
                    except Exception:
                        pass
                # 断开后等一等再重连（退避）
                if self._running.is_set():
                    time.sleep(reconnect_delay)


# ── 麦克风采集 ────────────────────────────────────────────────
class Microphone:
    """读取默认麦克风，输出 16kHz 单声道 int16 PCM。"""

    def __init__(self):
        self._pa = None
        self._stream = None
        self._dev_rate = SAMPLE_RATE
        self._dev_channels = 1
        self._dev_chunk = CHUNK_SIZE

    def open(self):
        self._pa = pyaudio.PyAudio()
        info = self._pa.get_default_input_device_info()
        idx = int(info['index'])
        name = str(info['name'])
        self._dev_channels = min(2, max(1, int(info.get('maxInputChannels', 1))))

        for rate in (SAMPLE_RATE, int(info['defaultSampleRate'])):
            try:
                self._dev_rate = rate
                self._dev_chunk = int(rate * CHUNK_MS / 1000)
                self._stream = self._pa.open(
                    format=pyaudio.paInt16,
                    channels=self._dev_channels,
                    rate=rate,
                    input=True,
                    input_device_index=idx,
                    frames_per_buffer=self._dev_chunk,
                )
                break
            except OSError:
                self._stream = None

        if self._stream is None:
            self._pa.terminate()
            raise RuntimeError(f'无法打开麦克风: {name}')
        print(f'[ear] 麦克风 "{name}" ({self._dev_rate}Hz, {self._dev_channels}ch)')

    def read(self) -> bytes:
        raw = self._stream.read(self._dev_chunk, exception_on_overflow=False)
        audio = np.frombuffer(raw, dtype=np.int16)
        if self._dev_channels > 1:
            audio = audio.reshape(-1, self._dev_channels).mean(axis=1)
        if self._dev_rate != SAMPLE_RATE:
            n_out = int(len(audio) * SAMPLE_RATE / self._dev_rate)
            x_old = np.linspace(0.0, 1.0, num=len(audio), endpoint=False)
            x_new = np.linspace(0.0, 1.0, num=n_out, endpoint=False)
            audio = np.interp(x_new, x_old, audio.astype(np.float64))
        return np.clip(audio, -32768, 32767).astype(np.int16).tobytes()

    def close(self):
        if self._stream:
            try:
                self._stream.stop_stream()
                self._stream.close()
            except Exception:
                pass
        if self._pa:
            self._pa.terminate()


# ── 远端麦克风（通过 rtw mic_relay TCP 桥接浏览器麦克风） ─────
class RemoteMicrophone:
    """从 rtw mic_relay 的 TCP 端口读 16kHz/16bit/mono PCM。"""
    RELAY_HOST = '127.0.0.1'
    RELAY_PORT = 7691
    BYTES_PER_CHUNK = CHUNK_SIZE * 2  # int16 = 2 bytes/sample

    def __init__(self):
        self._sock = None

    def open(self):
        import socket
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._sock.connect((self.RELAY_HOST, self.RELAY_PORT))
        print(f'[ear] 远端麦克风 (rtw mic_relay {self.RELAY_HOST}:{self.RELAY_PORT})')

    def read(self) -> bytes:
        buf = b''
        while len(buf) < self.BYTES_PER_CHUNK:
            chunk = self._sock.recv(self.BYTES_PER_CHUNK - len(buf))
            if not chunk:
                raise ConnectionError('mic relay disconnected')
            buf += chunk
        return buf

    def close(self):
        if self._sock:
            try: self._sock.close()
            except Exception: pass

    @staticmethod
    def available() -> bool:
        import socket
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(0.3)
            s.connect((RemoteMicrophone.RELAY_HOST, RemoteMicrophone.RELAY_PORT))
            s.close()
            return True
        except Exception:
            return False


# ── 主循环 ────────────────────────────────────────────────────
def main():
    if len(sys.argv) < 2:
        print("用法: python3 ear_recorder.py <output_jsonl_path>")
        sys.exit(1)

    output_path = sys.argv[1]
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    cfg = load_config()
    if not cfg['doubao_app_key'] or not cfg['doubao_access_key']:
        print("[ear] 缺少豆包凭证。设置 config.json 或环境变量 DOUBAO_APP_KEY / DOUBAO_ACCESS_KEY")
        sys.exit(1)

    print(f"[ear] 启动 — 源语言={cfg['src_lang']} 目标={cfg['tgt_lang']}")
    print(f"[ear] 输出 {output_path}")

    if RemoteMicrophone.available():
        mic = RemoteMicrophone()
    else:
        mic = Microphone()
    mic.open()

    transcriber = DoubaoTranscriber(
        app_key=cfg['doubao_app_key'],
        access_key=cfg['doubao_access_key'],
        src_lang=cfg['src_lang'],
        tgt_lang=cfg['tgt_lang'],
        idle_close_s=float(cfg['idle_close_s']),
    )

    output_lock = threading.Lock()

    def on_result(rec: dict):
        # 只写整句(final)，delta 太碎忽略
        if rec.get('is_final') and rec['text']:
            with output_lock:
                with open(output_path, 'a', encoding='utf-8') as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + '\n')
            print(f"[ear ✓] {rec['text']}")

    transcriber.start(on_result)

    MUTE_FILE = "/tmp/pi_mouth_speaking"

    silence_rms = float(cfg['silence_rms'])
    hangover_s = float(cfg['silence_hangover_s'])
    voice_until = 0.0

    try:
        while True:
            pcm = mic.read()
            # mouth 正在说话时跳过，防止回声
            if os.path.exists(MUTE_FILE):
                continue
            audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
            rms = float(np.sqrt(np.mean(audio ** 2))) if len(audio) else 0.0
            now = time.monotonic()
            if rms >= silence_rms:
                voice_until = now + hangover_s
            if now <= voice_until:
                transcriber.feed(pcm)
    except KeyboardInterrupt:
        pass
    finally:
        print("[ear] 关闭")
        transcriber.stop()
        mic.close()


if __name__ == '__main__':
    main()
