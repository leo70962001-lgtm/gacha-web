r"""機台動作的效果音：真的錄音 → web/assets/sfx/<name>.mp3（使用者 2026-11-21：「去網上參考 音效很不對」）
來源（D:/ai/gemini/gacha/sfx/real/，下載前問過）：
  効果音ラボ  https://soundeffect-lab.info/  （不用標示；不能再散布原檔、不能做成讓人自由放音效的工具）
    monetary-offering1.mp3  賽銭を投げ入れる      → sfx_coin_wood
    card-turn-over1.mp3     カードをめくる        → sfx_card
    paper-take2.mp3         紙を広げる（ピンと）  → omi_unfold
  ポケットサウンド  https://pocket-se.info/  （App 裡要放「效果音：ポケットサウンド」連結）
    gatyagatya.mp3          ガチャガチャのレバーを回す音 → sfx_tick / sfx_tick2 / sfx_tick3（一聲一聲切開）
    zihanki_insert.mp3      自動販売機にお金を入れる音   → sfx_coin
    zihanki_output.mp3      自動販売機から缶が出てくる音 → sfx_thud（「ガコン」那一段，音高稍微拉高＝比較輕的塑膠扭蛋）
    futa.mp3                プラスチックの音「ガチャコ」  → sfx_pop
每段：裁頭尾、10 ms 淡入、尾巴淡出、峰值拉到 −3 dB，單聲道 128 kbps。真錄音不再低通（之前 Gemini 的「叮」全擠在 1.7–2.5 kHz）。
  py -I tools/make_real_sfx.py"""
import os, re, subprocess
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
SRC = 'D:/ai/gemini/gacha/sfx/real/'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web', 'assets', 'sfx')

# name: (file, start, end, fade-out, extra filter)
CUTS = {
    'sfx_coin': ('zihanki_insert.mp3', 0.06, 1.30, 0.25, ''),
    'sfx_coin_wood': ('monetary-offering1.mp3', 0.06, 1.07, 0.15, ''),
    'sfx_tick': ('gatyagatya.mp3', 0.52, 0.78, 0.10, ''),
    'sfx_tick2': ('gatyagatya.mp3', 0.33, 0.52, 0.06, ''),
    'sfx_tick3': ('gatyagatya.mp3', 1.15, 1.50, 0.12, ''),
    'sfx_thud': ('zihanki_output.mp3', 0.86, 1.60, 0.25, 'asetrate=44100*1.12,aresample=44100,highpass=f=90'),
    'sfx_pop': ('futa.mp3', 0.0, 0.38, 0.10, ''),
    'sfx_card': ('card-turn-over1.mp3', 0.08, 0.45, 0.08, ''),
    'omi_unfold': ('paper-take2.mp3', 0.0, 0.70, 0.25, ''),
}


def run():
    for name, (f, a, b, fo, extra) in CUTS.items():
        dur = b - a
        af = f'afade=t=in:d=0.01,afade=t=out:st={dur - fo:.3f}:d={fo:.3f}'
        if extra:
            af = extra + ',' + af
        tmp = os.path.join(OUT, name + '.wav')
        subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-ss', str(a), '-t', f'{dur:.3f}', '-i', SRC + f,
                        '-af', af, '-ac', '1', '-ar', '44100', tmp], check=True)
        r = subprocess.run([FF, '-hide_banner', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True, encoding='utf-8', errors='replace')
        peak = float(re.search(r'max_volume: (-?[\d.]+) dB', r.stderr).group(1))
        dst = os.path.join(OUT, name + '.mp3')
        subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-af', f'volume={-3 - peak:.2f}dB',
                        '-b:a', '128k', '-map_metadata', '-1', dst], check=True)
        os.remove(tmp)
        print(f'{name:14s} {f:24s} {a:.2f}-{b:.2f}s peak {peak:6.1f} dB -> {round(os.path.getsize(dst) / 1024)} KB')


if __name__ == '__main__':
    run()
