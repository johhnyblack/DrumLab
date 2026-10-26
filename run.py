"""Cross-platform local launcher: python run.py --setup --open"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import venv
import webbrowser

if sys.version_info<(3,12):
    sys.exit('DrumLab 需要 Python 3.12 或更高版本。')
ROOT=Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description='启动 DrumLab 本地工作室')
parser.add_argument('--setup',action='store_true',help='创建 Python 环境、安装依赖并构建前端')
parser.add_argument('--open',action='store_true',help='打开浏览器')
parser.add_argument('--port',type=int,default=8765)
parser.add_argument('--omr-font',choices=['Bravura','JazzPerc'],help='按原谱选择识谱字体')
parser.add_argument('--omr-small-notes',action='store_true',help='启用小符头和小连梁识别')
args=parser.parse_args()
if args.omr_font: os.environ['AUDIVERIS_MUSIC_FONT']=args.omr_font
if args.omr_small_notes: os.environ['AUDIVERIS_SMALL_NOTES']='true'
# Use the project-local engine when installed; an explicit setting takes priority.
local_omr=ROOT/'.tools'/'audiveris-drumlab.sh'
if os.name!='nt' and not os.environ.get('AUDIVERIS_BIN') and local_omr.is_file():
    os.environ['AUDIVERIS_BIN']=str(local_omr)

python=ROOT/'.venv'/('Scripts/python.exe' if os.name=='nt' else 'bin/python')
def run(command): subprocess.run([str(v) for v in command],cwd=ROOT,check=True)
try:
    if args.setup:
        if not python.exists(): venv.create(ROOT/'.venv',with_pip=True)
        run([python,'-m','pip','install','-r','backend/requirements.txt'])
        npm=shutil.which('npm.cmd' if os.name=='nt' else 'npm')
        if not npm: raise RuntimeError('请先安装 Node.js 22.12+，然后重新运行')
        run([npm,'ci']);run([npm,'run','build'])
    if not python.exists() or not (ROOT/'dist/index.html').exists():
        raise RuntimeError('首次启动请运行：python run.py --setup --open')
    url=f'http://localhost:{args.port}'
    print(f'DrumLab: {url}\n按 Ctrl+C 停止。音频保留在本机。',flush=True)
    if args.open:
        def open_when_ready():
            for _ in range(120):
                try:
                    with urllib.request.urlopen(url+'/api/health',timeout=1) as response:
                        if response.status==200:
                            webbrowser.open(url)
                            return
                except OSError:
                    time.sleep(.5)
        threading.Thread(target=open_when_ready,daemon=True).start()
    run([python,'-m','uvicorn','backend.main:app','--host','127.0.0.1','--port',args.port])
except KeyboardInterrupt:
    pass
except (RuntimeError,subprocess.CalledProcessError) as e:
    print(str(e),file=sys.stderr);sys.exit(1)
