#!/usr/bin/env python3
"""豆包 TTS 语音合成 — body.mouth 后端"""

import json, os, requests, sys, uuid, subprocess

APP_ID = os.environ.get('DOUBAO_APP_ID', '')
ACCESS_TOKEN = os.environ.get('DOUBAO_TOKEN', '')
VOICE = 'zh_female_vv_uranus_bigtts'
API_URL = 'https://openspeech.bytedance.com/api/v1/tts'
OUTPUT = '/tmp/pi_mouth.mp3'
MUTE = '/tmp/pi_mouth_speaking'

def tts(text):
    r = requests.post(API_URL,
        headers={'Authorization': f'Bearer;{ACCESS_TOKEN}','Content-Type':'application/json'},
        json={'app':{'appid':APP_ID,'token':ACCESS_TOKEN,'cluster':'volcano_tts'},
              'user':{'uid':'pi'},'audio':{'voice_type':VOICE,'encoding':'mp3','rate':24000},
              'request':{'reqid':str(uuid.uuid4()),'text':text,'text_type':'plain','operation':'query'}},
        timeout=15)
    if r.status_code == 200 and len(r.content) > 100:
        with open(OUTPUT,'wb') as f: f.write(r.content)
        return True
    print(f'[mouth] TTS({r.status_code})', file=sys.stderr)
    return False

if __name__ == '__main__':
    text = sys.argv[1] if len(sys.argv) > 1 else ''
    if not text.strip(): sys.exit(0)
    if not tts(text): sys.exit(1)
    try:
        with open(MUTE,'w') as f: f.write('1')
        subprocess.run(['afplay',OUTPUT], check=True, timeout=60)
    finally:
        try: os.remove(MUTE)
        except: pass
