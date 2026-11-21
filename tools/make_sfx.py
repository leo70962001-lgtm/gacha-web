r"""效果音：Gemini「音楽を作成」做的曲子 → 切出一段一段 → web/assets/sfx/<name>.mp3
  看哪裡有聲音：py -I tools/make_sfx.py scan D:/ai/gemini/gacha/sfx/fx_set.mp3
  切：        py -I tools/make_sfx.py cut D:/ai/gemini/gacha/sfx/fx_set.mp3 fx_sakura=0.0-3.4 fx_stars=5.1-8.0 ...
每段：開頭 10 ms 淡入、結尾 0.35 s 淡出，峰值拉到 −1 dB（短的聲音用 loudnorm 會忽大忽小），128 kbps 單聲道 mp3。
ffmpeg 用 imageio_ffmpeg 附的那個（跟 make_bgm.py 一樣）。"""
import os, re, subprocess, sys
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'sfx')


def scan(src):
    # 每 0.25 秒的音量（dB），再列出安靜的段落
    r = subprocess.run([FF, '-hide_banner', '-i', src, '-af', 'astats=metadata=1:reset=11025,ametadata=print:key=lavfi.astats.Overall.RMS_level', '-ar', '44100', '-f', 'null', '-'], capture_output=True, text=True)
    lv = [float(x) if x not in ('-inf', 'inf') else -120.0 for x in re.findall(r'RMS_level=(-?[\d.]+|-?inf)', r.stderr)]
    print('RMS dB every 0.25 s:')
    for i in range(0, len(lv), 20):
        print(f'{i * 0.25:6.2f}s ' + ' '.join(f'{v:4.0f}' for v in lv[i:i + 20]))
    r = subprocess.run([FF, '-hide_banner', '-i', src, '-af', 'silencedetect=n=-38dB:d=0.35', '-f', 'null', '-'], capture_output=True, text=True)
    print('\n'.join(l for l in r.stderr.splitlines() if 'silence_' in l))


def cut(src, specs):
    os.makedirs(OUT, exist_ok=True)
    for sp in specs:
        name, rng = sp.split('=')
        a, b = [float(x) for x in rng.split('-')]
        dur = b - a
        fade = min(0.35, dur * 0.25)
        tmp = os.path.join(OUT, name + '.wav')
        subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(a), '-t', str(dur), '-i', src,
                        '-af', f'afade=t=in:d=0.01,afade=t=out:st={dur - fade:.3f}:d={fade:.3f}', '-ac', '1', '-ar', '44100', tmp], check=True)
        r = subprocess.run([FF, '-hide_banner', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True)
        peak = float(re.search(r'max_volume: (-?[\d.]+) dB', r.stderr).group(1))
        dst = os.path.join(OUT, name + '.mp3')
        subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', f'volume={-1 - peak:.2f}dB', '-b:a', '128k', '-map_metadata', '-1', dst], check=True)
        os.remove(tmp)
        print(name, f'{a}-{b}s', f'peak {peak} dB', round(os.path.getsize(dst) / 1024), 'KB')


if __name__ == '__main__':
    if sys.argv[1] == 'scan':
        scan(sys.argv[2])
    else:
        cut(sys.argv[2], sys.argv[3:])
