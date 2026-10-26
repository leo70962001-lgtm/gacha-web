r"""背景音樂：Gemini「音楽を作成」下載的曲子 → web/assets/bgm/<id>.mp3
  py -I tools/make_bgm.py D:/ai/gemini/gacha/bgm
每首：音量拉到一樣（loudnorm，-19 LUFS：在效果音底下不搶）、96 kbps 立體聲 mp3（2 分鐘約 1.4 MB）。
ffmpeg 用 imageio_ffmpeg 附的那個。"""
import os, subprocess, sys
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'bgm')
os.makedirs(out, exist_ok=True)
for f in sorted(os.listdir(src)):
    if not f.lower().endswith('.mp3'):
        continue
    dst = os.path.join(out, f)
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', os.path.join(src, f),
                    '-af', 'loudnorm=I=-19:TP=-2:LRA=11', '-ar', '44100', '-ac', '2', '-b:a', '96k', '-map_metadata', '-1', dst], check=True)
    print(f, round(os.path.getsize(dst) / 1024), 'KB')
