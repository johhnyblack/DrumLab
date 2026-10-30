"""Turn a public Bilibili scrolling score into a local, image-based PDF."""
import re
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import cv2
import httpx
import numpy as np
import pymupdf as fitz

HEADERS = {'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.bilibili.com/'}
MAX_BYTES = 150 * 1024 * 1024


def create_video_pdf(url: str) -> bytes:
    parsed = urlparse(url.strip())
    if parsed.scheme != 'https' or parsed.hostname not in ('www.bilibili.com', 'bilibili.com', 'm.bilibili.com'):
        raise ValueError('请输入完整的 B 站视频链接（https://www.bilibili.com/video/BV…）')
    match = re.fullmatch(r'/video/(BV[0-9A-Za-z]{10})/?', parsed.path)
    if not match:
        raise ValueError('请使用包含 BV 号的 B 站视频链接')
    bvid = match.group(1)
    with httpx.Client(headers=HEADERS, timeout=30, follow_redirects=False, trust_env=True) as client:
        view = client.get('https://api.bilibili.com/x/web-interface/view', params={'bvid': bvid}).json()
        if view.get('code') != 0:
            raise ValueError('无法读取视频信息，请确认链接有效且视频可公开观看')
        info = view['data']
        if info.get('videos', 1) != 1:
            raise ValueError('暂不支持多 P 视频，请使用单个视频')
        if info.get('duration', 0) > 900:
            raise ValueError('视频最长支持 15 分钟')
        play = client.get('https://api.bilibili.com/x/player/playurl', params={'bvid': bvid, 'cid': info['cid'], 'qn': 64, 'fnval': 0}).json()
        streams = play.get('data', {}).get('durl', [])
        if play.get('code') != 0 or len(streams) != 1:
            raise ValueError('无法获取公开的视频画面，可能需要登录或该视频不支持直接访问')
        stream = streams[0]
        media = urlparse(stream['url'])
        if media.scheme != 'https' or not (media.hostname or '').endswith('.bilivideo.com'):
            raise ValueError('视频来源不受支持')
        if stream.get('size', 0) > MAX_BYTES:
            raise ValueError('视频文件超过 150 MB')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'video.mp4'
            total = 0
            with client.stream('GET', stream['url']) as response:
                response.raise_for_status()
                with path.open('wb') as output:
                    for chunk in response.iter_bytes():
                        total += len(chunk)
                        if total > MAX_BYTES:
                            raise ValueError('视频文件超过 150 MB')
                        output.write(chunk)
            return _stitch(path)


def _stitch(path: Path) -> bytes:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise ValueError('无法解码视频')
    fps = capture.get(cv2.CAP_PROP_FPS)
    count = capture.get(cv2.CAP_PROP_FRAME_COUNT)
    if not fps or not count or count / fps > 905:
        raise ValueError('无法确定视频时长或视频过长')
    duration = count / fps
    previous = None
    strips = []
    advances = 0
    for second in np.arange(0, duration, 3):
        capture.set(cv2.CAP_PROP_POS_MSEC, float(second * 1000))
        ok, frame = capture.read()
        if not ok:
            raise ValueError('视频解码中断，未生成不完整的谱面')
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # Compare downsized images to find the vertical overlap, tolerating the moving cursor.
        scale = 640 / gray.shape[1]
        small = cv2.resize(gray, (640, max(1, round(gray.shape[0] * scale))))
        h = small.shape[0]
        if previous is None:
            strips.append(gray)
        else:
            a = previous[:, 20:620].astype(np.int16)
            b = small[:, 20:620].astype(np.int16)
            scores = [float(np.mean(np.abs(a[shift:] - b[:h-shift]))) for shift in range(min(h // 2, 200))]
            shift = int(np.argmin(scores))
            if scores[shift] > 12:
                raise ValueError(f'第 {int(second)} 秒附近的画面无法连续拼接，请使用谱面纵向滚动的视频')
            if shift:
                real_shift = round(shift / scale)
                strips.append(gray[-real_shift:])
                advances += 1
        previous = small
    capture.release()
    if advances < 2:
        raise ValueError('未检测到连续滚动的谱面，无法自动生成完整 PDF')
    stitched = np.concatenate(strips, axis=0)
    width = stitched.shape[1]
    # Select the lightest gap near each page boundary to avoid cutting a staff.
    page_height = int(width * 1.35)
    doc = fitz.open()
    top = 0
    while top < stitched.shape[0]:
        end = min(top + page_height, stitched.shape[0])
        if end < stitched.shape[0]:
            lo, hi = max(top + page_height // 2, end - page_height // 5), min(stitched.shape[0], end + page_height // 10)
            whiteness = np.mean(stitched[lo:hi, int(width*.03):int(width*.97)] > 220, axis=1)
            window = max(3, width // 100)
            smooth = np.convolve(whiteness, np.ones(window)/window, mode='same')
            end = lo + int(np.argmax(smooth))
        image = stitched[top:end]
        if image.size == 0:
            raise ValueError('谱面分页失败')
        ok, encoded = cv2.imencode('.png', image)
        if not ok:
            raise ValueError('谱面图片生成失败')
        # PDF dimensions are points, not pixels. Audiveris rasterizes PDFs at
        # 300 DPI, so using the video width as points can exceed its pixel limit.
        page = doc.new_page(width=612, height=612 * image.shape[0] / width)
        page.insert_image(page.rect, stream=encoded.tobytes())
        top = end
    result = doc.tobytes(deflate=True)
    doc.close()
    return result
